import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());
describe.sequential("App", () => {
  it("shows loading then the ready workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/dashboard"
              ? {
                  asOf: "2026-08-10T12:00:00.000Z",
                  semantics: {
                    recentFrom: "",
                    upcomingTo: "",
                    closeFrom: "",
                    closeTo: "",
                    staleBefore: "",
                    trendFrom: "",
                    trendTo: "",
                  },
                  openPipeline: { count: 0, totals: [] },
                  stageDistribution: [],
                  outcomeTrend: [],
                  recentActivity: { count: 0, items: [] },
                  tasks: { overdue: 0, upcoming: 0 },
                  closingSoon: { count: 0, totals: [] },
                  staleAccounts: { count: 0 },
                }
              : {
                  user: {
                    id: "user_owner",
                    email: "owner@northstar.test",
                    displayName: "Northstar Owner",
                    role: "owner",
                  },
                },
        }),
      ),
    );
    render(<App />);
    expect(screen.getByText("Loading your workspace")).toBeInTheDocument();
    expect(
      await screen.findByText("Good morning, Northstar"),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
  it("shows an expired-session sign-in state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ code: "SESSION_EXPIRED" }),
      }),
    );
    render(<App />);
    expect(
      await screen.findByText(
        "Your session expired. Sign in again to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });
  it("shows an actionable unavailable state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText("Northstar is temporarily unavailable"),
      ).toBeInTheDocument(),
    );
  });
});
