import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "./AuditPage";

const event = {
  id: "e-1",
  action: "member.created",
  entityType: "membership",
  entityId: "m-1",
  actorMembershipId: "m-owner",
  actorName: "Owner",
  summary: { detail: "Created <member>" },
  occurredAt: "2026-08-10T12:00:00.000Z",
  correlationId: "corr-1",
};
const result = {
  items: [event],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};
const ok = (body: unknown) => ({ ok: true, json: async () => body });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("AuditPage", () => {
  it("loads safe summaries, UTC timestamps, and correlation IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(result));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("member.created")).toBeInTheDocument();
    expect(screen.getByText(/Created/)).toHaveTextContent("Created <member>");
    expect(screen.getByRole("time")).toHaveTextContent("UTC");
    expect(screen.getByText("corr-1")).toBeInTheDocument();
  });
  it("applies and clears query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(result));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditPage />);
    await screen.findByText("member.created");
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "member.created" },
    });
    fireEvent.change(screen.getByLabelText("Entity type"), {
      target: { value: "membership" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/audit?page=1&pageSize=20&action=member.created&entityType=membership",
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/audit?page=1&pageSize=20",
        expect.anything(),
      ),
    );
  });
  it("shows empty and retry states", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Unavailable" }),
      })
      .mockResolvedValueOnce(ok({ ...result, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("No audit events found"),
    ).toBeInTheDocument();
  });
});
