import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());
describe("App", () => {
  it("shows loading then the ready workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ product: "Northstar CRM", status: "ready" }),
      }),
    );
    render(<App />);
    expect(screen.getByText("Loading your workspace…")).toBeInTheDocument();
    expect(
      await screen.findByText("Your customer workspace is ready."),
    ).toBeInTheDocument();
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
