import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportsPage } from "./ImportsPage";

afterEach(() => vi.unstubAllGlobals());

describe.sequential("ImportsPage", () => {
  it("maps, previews, and explicitly commits a clean CSV", async () => {
    const result = {
      id: "import_1",
      resource: "companies",
      sourceName: "accounts.csv",
      status: "previewed",
      summary: { total: 1, valid: 1, warnings: 0, errors: 0 },
      rows: [
        {
          rowNumber: 2,
          status: "valid",
          errors: [],
          normalized: { name: "Acme", externalReference: "AC-1" },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ import: result }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          import: { ...result, status: "committed" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportsPage role="member" />);
    await fireEvent.change(screen.getByLabelText("CSV file"), {
      target: {
        files: [
          new File(["Company,Reference\nAcme,AC-1\n"], "accounts.csv", {
            type: "text/csv",
          }),
        ],
      },
    });
    fireEvent.change(await screen.findByLabelText("Name (required)"), {
      target: { value: "Company" },
    });
    fireEvent.change(screen.getByLabelText("External reference"), {
      target: { value: "Reference" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request preview" }));
    expect(
      await screen.findByRole("heading", { name: "accounts.csv" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Commit clean preview" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Committed successfully")).toBeInTheDocument(),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/imports/import_1/commit");
  });

  it("keeps viewers read-only while retaining filtered export controls", () => {
    render(<ImportsPage role="viewer" />);
    expect(screen.getByText(/Viewer access is read-only/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request preview" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/api/exports/companies.csv",
    );
  });
});
