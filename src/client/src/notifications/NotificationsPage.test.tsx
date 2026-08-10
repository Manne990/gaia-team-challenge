import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./NotificationsPage";

const notification = {
  id: "notification_1",
  kind: "task",
  title: "Task assigned to you",
  body: "Follow up with Acme.",
  entityType: "task",
  entityId: "task_1",
  href: "/tasks/task_1",
  occurredAt: "2026-08-10T12:00:00.000Z",
  readAt: null,
};
const response = { items: [notification], unreadCount: 1 };
const ok = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("NotificationsPage", () => {
  it("shows loading and then the notification list with UTC time and related link", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading notifications",
    );
    resolve?.(ok(response));
    expect(
      await screen.findByRole("heading", { name: "Task assigned to you" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("time")).toHaveTextContent(
      "Aug 10, 2026, 12:00 PM UTC",
    );
    expect(
      screen.getByRole("link", { name: /View related task/ }),
    ).toHaveAttribute("href", "/tasks/task_1");
    expect(screen.getByText("1 unread")).toBeInTheDocument();
  });

  it("changes the API filter and marks one notification as read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(response))
      .mockResolvedValueOnce(ok(response))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ items: [], unreadCount: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPage />);
    await screen.findByRole("heading", { name: "Task assigned to you" });
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/notifications?filter=unread",
        expect.anything(),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark as read" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/notification_1/read",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("marks all notifications as read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(response))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ items: [], unreadCount: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPage />);
    await screen.findByRole("heading", { name: "Task assigned to you" });
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/read-all",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });

  it("shows an empty state and a retry action after an error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Service unavailable" }),
      })
      .mockResolvedValueOnce(ok({ items: [], unreadCount: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Service unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });
});
