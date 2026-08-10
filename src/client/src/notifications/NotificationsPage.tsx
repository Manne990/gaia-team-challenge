import { useCallback, useEffect, useState } from "react";
import "./notifications.css";

type NotificationFilter = "all" | "unread";
type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  href: string | null;
  occurredAt: string;
  readAt: string | null;
};
type NotificationResponse = {
  items: NotificationItem[];
  unreadCount: number;
};
type RequestError = { message: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw {
      message: "The network request failed. Try again.",
    } satisfies RequestError;
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw {
      message: body.error ?? "The request could not be completed.",
    } satisfies RequestError;
  }
  return body as T;
}

function formatUtc(value: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

export function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [result, setResult] = useState<NotificationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(
        await request<NotificationResponse>(
          `/api/notifications?filter=${filter}`,
        ),
      );
    } catch (reason) {
      setError((reason as RequestError).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    // Load whenever the selected server-side filter changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    setBusyId(id);
    try {
      await request(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: "POST",
      });
      await load();
    } catch (reason) {
      setError((reason as RequestError).message);
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await request("/api/notifications/read-all", { method: "POST" });
      await load();
    } catch (reason) {
      setError((reason as RequestError).message);
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <section
      className="notifications-page"
      aria-labelledby="notifications-title"
    >
      <header className="notifications-header">
        <div>
          <p className="eyebrow">Updates</p>
          <h1 id="notifications-title">Notifications</h1>
          <p className="page-summary">
            Stay up to date with activity across your CRM.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={markingAll || !result?.unreadCount}
        >
          {markingAll ? "Marking all read…" : "Mark all as read"}
        </button>
      </header>

      <div className="notifications-toolbar" aria-label="Notification filters">
        <div
          className="notification-filters"
          role="group"
          aria-label="Show notifications"
        >
          <button
            type="button"
            className={filter === "all" ? "active" : undefined}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={filter === "unread" ? "active" : undefined}
            aria-pressed={filter === "unread"}
            onClick={() => setFilter("unread")}
          >
            Unread
          </button>
        </div>
        <span className="unread-count" aria-live="polite">
          {result?.unreadCount ?? 0} unread
        </span>
        <span className="utc-note">Times shown in UTC</span>
      </div>

      {loading && (
        <div className="notifications-state" role="status" aria-live="polite">
          Loading notifications…
        </div>
      )}
      {!loading && error && (
        <div className="notifications-state notifications-error" role="alert">
          <h2>Could not load notifications</h2>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!loading && !error && result?.items.length === 0 && (
        <div className="notifications-state">
          <h2>
            {filter === "unread"
              ? "You’re all caught up"
              : "No notifications yet"}
          </h2>
          <p>
            {filter === "unread"
              ? "There are no unread notifications."
              : "New activity will appear here."}
          </p>
        </div>
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <ul className="notification-list">
          {result.items.map((item) => {
            const unread = item.readAt === null;
            return (
              <li
                className={`notification${unread ? " notification-unread" : ""}`}
                key={item.id}
              >
                <div className="notification-content">
                  <div className="notification-meta">
                    <span className="notification-kind">{item.kind}</span>
                    <time dateTime={item.occurredAt}>
                      {formatUtc(item.occurredAt)}
                    </time>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.body}</p>
                  {item.href ? (
                    <a href={item.href}>
                      View related {item.entityType}{" "}
                      <span aria-hidden="true">→</span>
                    </a>
                  ) : (
                    <span className="notification-relation-unavailable">
                      Related record is no longer available
                    </span>
                  )}
                </div>
                {unread && (
                  <button
                    type="button"
                    onClick={() => void markRead(item.id)}
                    disabled={busyId === item.id || markingAll}
                  >
                    {busyId === item.id ? "Marking read…" : "Mark as read"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
