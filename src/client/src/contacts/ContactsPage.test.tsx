import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactsPage } from "./ContactsPage";

afterEach(() => vi.unstubAllGlobals());
const item = {
  id: "contact-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.test",
  companyName: "Analytical Engines",
  ownerName: "Grace",
  status: "active",
  tags: [],
  communicationPreference: "email",
  version: 1,
  duplicateWarning: true,
} as const;

describe("ContactsPage", () => {
  it("loads and presents contact list fields and duplicate warning", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [item],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ContactsPage role="owner" />);
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getAllByText("Analytical Engines").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Duplicate email").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Create contact" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/contacts?"),
      expect.anything(),
    );
  });

  it("does not expose mutation controls to viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [item],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
      }),
    );
    render(<ContactsPage role="viewer" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Ada Lovelace" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Create contact" }),
    ).not.toBeInTheDocument();
  });
});
