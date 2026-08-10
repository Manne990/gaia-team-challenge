import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./TasksPage";

const task = {
  id: "task_1",
  title: "Follow up",
  description: "Send the proposal.",
  assigneeMembershipId: "member_1",
  assigneeName: "Ada Owner",
  dueAt: "2026-08-10T12:00:00.000Z",
  priority: "high" as const,
  status: "open" as const,
  companyId: null,
  companyName: null,
  contactId: null,
  contactName: null,
  dealId: null,
  dealName: null,
  archivedAt: null,
  version: 7,
};
const list = {
  items: [task],
  assignees: [{ id: "member_1", name: "Ada Owner" }],
};
const detail = { task, history: [] };
const ok = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("TasksPage", () => {
  it("selects each server-side view in the list query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(list));
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksPage role="member" />);
    await screen.findByRole("button", { name: "Follow up" });
    fireEvent.change(screen.getByLabelText("Task view"), {
      target: { value: "overdue" },
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("view=overdue"),
    );
    fireEvent.change(screen.getByLabelText("Task view"), {
      target: { value: "today" },
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("view=today"),
    );
  });

  it("keeps viewers read-only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(list))
      .mockResolvedValue(ok(detail));
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksPage role="viewer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Follow up" }));
    expect(
      await screen.findByRole("heading", { name: "Task details" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("sends the displayed version for a successful mutation", async () => {
    const updated = { ...task, status: "completed" as const, version: 8 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(list))
      .mockResolvedValueOnce(ok(detail))
      .mockResolvedValueOnce(ok({ task: updated, history: [] }))
      .mockResolvedValue(ok({ items: [updated], assignees: list.assignees }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksPage role="member" />);
    fireEvent.click(await screen.findByRole("button", { name: "Follow up" }));
    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/task_1/complete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ version: 7 }),
        }),
      ),
    );
    expect(await screen.findByText("completed")).toBeInTheDocument();
  });

  it("shows a recoverable message for a 409 version conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(list))
      .mockResolvedValueOnce(ok(detail))
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error:
            "This task changed since you opened it. Refresh and try again.",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksPage role="member" />);
    fireEvent.click(await screen.findByRole("button", { name: "Follow up" }));
    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This task changed since you opened it",
    );
  });
});
