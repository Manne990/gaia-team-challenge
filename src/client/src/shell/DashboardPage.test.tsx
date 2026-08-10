import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

const dashboard = {
  asOf: "2026-08-10T12:00:00.000Z",
  semantics: {
    recentFrom: "2026-08-03T12:00:00.000Z",
    upcomingTo: "2026-08-17T12:00:00.000Z",
    closeFrom: "2026-08-10",
    closeTo: "2026-09-09",
    staleBefore: "2026-07-11T12:00:00.000Z",
    trendFrom: "2026-03-01T00:00:00.000Z",
    trendTo: "2026-09-01T00:00:00.000Z",
  },
  openPipeline: {
    count: 3,
    totals: [
      { currency: "USD", amountMinor: "125000" },
      { currency: "SEK", amountMinor: "9900" },
    ],
  },
  stageDistribution: [
    {
      id: "stage_1",
      name: "Qualified",
      count: 2,
      totals: [{ currency: "USD", amountMinor: "100000" }],
    },
  ],
  outcomeTrend: [
    {
      month: "2026-08",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
      won: 1,
      lost: 0,
    },
  ],
  recentActivity: {
    count: 1,
    items: [
      {
        id: "activity_1",
        type: "call",
        subject: "Follow-up",
        occurredAt: "2026-08-10T10:00:00.000Z",
        creatorLabel: "Ada",
        companyLabel: "Example Co",
      },
    ],
  },
  tasks: { overdue: 2, upcoming: 4 },
  closingSoon: {
    count: 1,
    totals: [{ currency: "USD", amountMinor: "50000" }],
  },
  staleAccounts: { count: 5 },
};
const ok = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("DashboardPage", () => {
  it("loads all API sections and links using API semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(dashboard));
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardPage userName="Ada Owner" />);
    expect(
      screen.getByRole("heading", { name: "Loading your dashboard" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Good morning, Ada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Qualified")).toBeInTheDocument();
    expect(screen.getAllByText("Follow-up").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Qualified/ })).toHaveAttribute(
      "href",
      "#deals?status=open&stageId=stage_1",
    );
    expect(screen.getByRole("link", { name: "1 won" })).toHaveAttribute(
      "href",
      expect.stringContaining("outcomeFrom=2026-08-01"),
    );
    expect(
      screen.getAllByRole("link", { name: /Overdue tasks/ })[0],
    ).toHaveAttribute("href", expect.stringContaining("dueTo="));
    expect(screen.getAllByText(/SEK/).length).toBeGreaterThan(0);
  });

  it("supports retry and explicit refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(ok(dashboard));
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(
      fetchMock.mock.calls.every(([url]) => url === "/api/dashboard"),
    ).toBe(true);
  });
});
