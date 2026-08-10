import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "./GlobalSearch";
import { SavedViewsControl } from "./SavedViewsControl";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("search controls", () => {
  it("searches after two characters, groups results, and supports keyboard dismissal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: "ac",
        groups: [
          {
            resource: "companies",
            label: "Companies",
            items: [
              {
                id: "c1",
                title: "Acme",
                context: "Customer",
                href: "/companies/c1",
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GlobalSearch />);
    const input = screen.getByRole("combobox", {
      name: "Search your workspace",
    });
    fireEvent.change(input, { target: { value: "a" } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " ac " } });
    expect(
      await screen.findByRole("heading", { name: "Companies" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Acme Customer/ }),
    ).toHaveAttribute("href", "/companies/c1");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "search-result-0");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByRole("heading", { name: "Companies" }),
    ).not.toBeInTheDocument();
  });

  it("shows no matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ query: "zz", groups: [] }),
      }),
    );
    render(<GlobalSearch />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search your workspace" }),
      {
        target: { value: "zz" },
      },
    );
    expect(await screen.findByText("No matches found.")).toBeInTheDocument();
  });

  it("creates, applies, deletes views, and ignores malformed state", async () => {
    const onApply = vi.fn();
    const view = {
      id: "v1",
      resource: "companies",
      name: "Pipeline",
      state: { status: "open" },
      version: 2,
      createdAt: "",
      updatedAt: "",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ ...view, id: "bad", state: null }, view],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ view }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SavedViewsControl
        resource="companies"
        state={{ status: "open" }}
        onApply={onApply}
      />,
    );
    fireEvent.focus(screen.getByLabelText("Your views"));
    expect(
      await screen.findByRole("option", { name: "Pipeline" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your views"), {
      target: { value: "v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ status: "open" });
    fireEvent.change(screen.getByLabelText("Save current view"), {
      target: { value: "New view" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/saved-views",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/saved-views/v1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
