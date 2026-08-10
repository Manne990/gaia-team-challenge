import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealsPage } from "./DealsPage";

beforeEach(() => cleanup());
afterEach(() => vi.unstubAllGlobals());
const deal = {
  id: "d1",
  name: "Launch project",
  companyId: "c1",
  companyName: "Acme",
  ownerMembershipId: "m1",
  ownerName: "Ada",
  stageId: "s1",
  stageName: "Qualified",
  amountMinor: 12345,
  currency: "USD",
  probability: 40,
  expectedCloseDate: null,
  status: "open",
  lossReason: null,
  archivedAt: null,
  version: 1,
  contactIds: [],
} as const;
const response = () => ({
  items: [deal],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  totals: {
    amountMinor: 12345,
    currency: "USD",
    byCurrency: [{ currency: "USD", amountMinor: 12345 }],
  },
  stages: [
    {
      id: "s1",
      name: "Qualified",
      position: 1,
      kind: "open",
      active: 1,
      version: 1,
    },
  ],
});

describe.sequential("DealsPage", () => {
  it("shares filters and renders totals in table and pipeline views", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response() });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<DealsPage role="owner" />);
    const view = within(container);
    expect(await view.findByText("Launch project")).toBeInTheDocument();
    expect(view.getAllByText("Total pipeline: $123.45").length).toBeGreaterThan(
      0,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain("includeArchived=false");
    expect(view.getByRole("button", { name: "Pipeline" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Table" })).toBeInTheDocument();
  });
  it("hides mutation controls from viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => response() }),
    );
    const { container } = render(<DealsPage role="viewer" />);
    const view = within(container);
    await view.findByText("Launch project");
    expect(
      view.queryByRole("button", { name: "Create deal" }),
    ).not.toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });
});
