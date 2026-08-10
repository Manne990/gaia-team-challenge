import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { UserRole } from "../shell/navigation";
import { StatePanel } from "../ui/StatePanel";
import { readListState, writeListState } from "../search/urlState";

type Activity = {
  id: string;
  type: string;
  subject: string;
  body: string;
  occurredAt: string;
  creatorLabel: string;
  companyLabel: string | null;
  contactLabel: string | null;
  followUpTitle: string | null;
  version: number;
  participants: Array<{ id: string; label: string }>;
};
type List = {
  items: Activity[];
  page: number;
  total: number;
  totalPages: number;
};
const activityTypes = ["call", "email", "meeting", "note", "status_change"];

export function ActivitiesPage({ role }: { role: UserRole }) {
  const initial = readListState("activities");
  const [list, setList] = useState<List | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [type, setType] = useState(initial.type ?? ""),
    [author, setAuthor] = useState(initial.authorId ?? ""),
    [from, setFrom] = useState(initial.from ?? ""),
    [to, setTo] = useState(initial.to ?? ""),
    [page, setPage] = useState(1),
    [composing, setComposing] = useState(false),
    [selected, setSelected] = useState<Activity | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (type) q.set("type", type);
    if (author) q.set("authorId", author);
    if (from) q.set("from", new Date(from).toISOString());
    if (to) q.set("to", new Date(to).toISOString());
    try {
      const response = await fetch(`/api/activities?${q}`);
      if (!response.ok)
        throw new Error("The activity timeline could not be loaded.");
      setList(await response.json());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The activity timeline could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, type, author, from, to]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle owns loading state
    void load();
  }, [load]);
  useEffect(() => {
    writeListState("activities", {
      type,
      authorId: author,
      from: from ? new Date(from).toISOString() : "",
      to: to ? new Date(to).toISOString() : "",
      page: String(page),
    });
  }, [author, from, page, to, type]);
  if (error && !list)
    return (
      <StatePanel
        kind="error"
        title="Could not load activities"
        detail={error}
        action={<button onClick={() => void load()}>Try again</button>}
      />
    );
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Shared history</p>
          <h1>Activities</h1>
          <p>
            Calls, emails, meetings, notes, and status changes across your
            workspace.
          </p>
        </div>
        <button
          disabled={role === "viewer"}
          title={
            role === "viewer" ? "Viewers cannot create activities" : undefined
          }
          onClick={() => setComposing(true)}
        >
          Record activity
        </button>
      </header>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
        aria-label="Activity filters"
      >
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {activityTypes.map((x) => (
              <option key={x} value={x}>
                {x.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Author membership
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="membership ID"
          />
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={localDateTime(from)}
            onChange={(e) => setFrom(toIso(e.target.value))}
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            value={localDateTime(to)}
            onChange={(e) => setTo(toIso(e.target.value))}
          />
        </label>
        <button type="submit">Apply</button>
      </form>
      {loading && !list ? (
        <StatePanel kind="loading" title="Loading activity timeline" />
      ) : list?.items.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No activities match"
          detail="Change the filters or record a new activity."
        />
      ) : (
        <ol className="timeline" aria-label="Activity timeline">
          {list?.items.map((item) => (
            <li key={item.id}>
              <button
                className="timeline-card"
                onClick={() => setSelected(item)}
              >
                <span className="activity-type">
                  {item.type.replace("_", " ")}
                </span>
                <strong>{item.subject}</strong>
                <span>
                  {item.creatorLabel} ·{" "}
                  <time dateTime={item.occurredAt}>
                    {new Date(item.occurredAt).toLocaleString()}
                  </time>
                </span>
                {(item.companyLabel || item.contactLabel) && (
                  <small>
                    {[item.companyLabel, item.contactLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
      {list && (
        <nav className="pagination" aria-label="Timeline pages">
          <button
            className="button-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {list.totalPages} · {list.total} records
          </span>
          <button
            className="button-secondary"
            disabled={page >= list.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
      {composing && (
        <ActivityComposer
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            void load();
          }}
        />
      )}
      {selected && (
        <ActivityDialog
          activity={selected}
          role={role}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function localDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function ActivityComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const followTitle = String(data.get("followTitle") ?? "").trim();
    const payload = {
      type: data.get("type"),
      subject: data.get("subject"),
      body: data.get("body"),
      occurredAt: new Date(String(data.get("occurredAt"))).toISOString(),
      companyId: String(data.get("companyId") || "") || null,
      contactId: String(data.get("contactId") || "") || null,
      dealId: String(data.get("dealId") || "") || null,
      participantContactIds: String(data.get("participants") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      followUp: followTitle
        ? {
            title: followTitle,
            description: "",
            assigneeMembershipId: data.get("assignee"),
            dueAt: new Date(String(data.get("dueAt"))).toISOString(),
            priority: data.get("priority"),
          }
        : null,
    };
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) onCreated();
    else {
      const body = (await response.json()) as { message?: string };
      setMessage(body.message ?? "The activity could not be saved.");
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="activity-form-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form className="dialog-body form-grid" onSubmit={(e) => void submit(e)}>
        <h2 id="activity-form-title">Record activity</h2>
        <label>
          Type
          <select name="type">
            {activityTypes.map((x) => (
              <option key={x} value={x}>
                {x.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <input name="subject" required maxLength={200} />
        </label>
        <label>
          Occurred at
          <input
            name="occurredAt"
            type="datetime-local"
            required
            defaultValue={new Date().toISOString().slice(0, 16)}
          />
        </label>
        <label>
          Summary
          <textarea name="body" maxLength={10000} />
        </label>
        <label>
          Company ID
          <input name="companyId" />
        </label>
        <label>
          Contact ID
          <input name="contactId" />
        </label>
        <label>
          Deal ID
          <input name="dealId" />
        </label>
        <label>
          Participant contact IDs
          <input name="participants" placeholder="comma separated" />
        </label>
        <fieldset>
          <legend>Optional follow-up</legend>
          <label>
            Title
            <input name="followTitle" />
          </label>
          <label>
            Assignee membership ID
            <input name="assignee" />
          </label>
          <label>
            Due at
            <input name="dueAt" type="datetime-local" />
          </label>
          <label>
            Priority
            <select name="priority">
              <option>medium</option>
              <option>low</option>
              <option>high</option>
              <option>urgent</option>
            </select>
          </label>
        </fieldset>
        {message && <p role="alert">{message}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit">Save activity</button>
        </div>
      </form>
    </dialog>
  );
}
function ActivityDialog({
  activity,
  role,
  onClose,
  onDeleted,
}: {
  activity: Activity;
  role: UserRole;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const remove = async () => {
    if (!window.confirm(`Delete activity “${activity.subject}”?`)) return;
    setDeleting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/activities/${activity.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || "The activity could not be deleted.");
      }
      dialog.current?.close();
      onDeleted();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The activity could not be deleted.",
      );
    } finally {
      setDeleting(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="activity-detail-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <article className="dialog-body">
        <p className="eyebrow">{activity.type.replace("_", " ")}</p>
        <h2 id="activity-detail-title">{activity.subject}</h2>
        <p>{activity.body || "No summary provided."}</p>
        <dl>
          <dt>Creator</dt>
          <dd>{activity.creatorLabel}</dd>
          <dt>Occurred</dt>
          <dd>{new Date(activity.occurredAt).toLocaleString()}</dd>
          {activity.followUpTitle && (
            <>
              <dt>Follow-up</dt>
              <dd>{activity.followUpTitle}</dd>
            </>
          )}
        </dl>
        {message && <p role="alert">{message}</p>}
        <div className="dialog-actions">
          {role !== "viewer" && (
            <button
              type="button"
              className="button-danger"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? "Deleting…" : "Delete activity"}
            </button>
          )}
          <button type="button" onClick={close} disabled={deleting}>
            Close
          </button>
        </div>
      </article>
    </dialog>
  );
}
