import { FormEvent, useCallback, useEffect, useState } from "react";
import { StatePanel } from "../ui/StatePanel";
import "./tasks.css";

type Role = "owner" | "member" | "viewer";
type View = "assigned_to_me" | "overdue" | "today" | "upcoming" | "completed";
type Task = {
  id: string;
  title: string;
  description: string;
  assigneeMembershipId: string;
  assigneeName: string;
  dueAt: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "completed" | "cancelled";
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealName: string | null;
  archivedAt: string | null;
  version: number;
};
type Assignee = { id: string; name: string };
type ApiError = { status: number; message: string; issues?: string[] };
type FormValues = {
  title: string;
  description: string;
  assigneeMembershipId: string;
  dueAt: string;
  priority: Task["priority"];
  companyId: string;
  contactId: string;
  dealId: string;
};

const blankForm: FormValues = {
  title: "",
  description: "",
  assigneeMembershipId: "",
  dueAt: "",
  priority: "medium",
  companyId: "",
  contactId: "",
  dealId: "",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw {
      status: 0,
      message: "The network request failed. Try again.",
    } satisfies ApiError;
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: string[];
  };
  if (!response.ok)
    throw {
      status: response.status,
      message: body.error ?? "The request could not be completed.",
      issues: body.issues,
    } satisfies ApiError;
  return body as T;
}

function formFromTask(task: Task): FormValues {
  return {
    title: task.title,
    description: task.description,
    assigneeMembershipId: task.assigneeMembershipId,
    dueAt: task.dueAt.slice(0, 16),
    priority: task.priority,
    companyId: task.companyId ?? "",
    contactId: task.contactId ?? "",
    dealId: task.dealId ?? "",
  };
}

function toPayload(form: FormValues, version?: number) {
  const payload = {
    ...form,
    title: form.title.trim(),
    description: form.description.trim(),
    dueAt: form.dueAt ? `${form.dueAt}:00.000Z` : "",
    companyId: form.companyId.trim() || null,
    contactId: form.contactId.trim() || null,
    dealId: form.dealId.trim() || null,
  };
  return version === undefined ? payload : { ...payload, version };
}

export function TasksPage({
  role,
  initialTaskId,
}: {
  role: Role;
  initialTaskId?: string;
}) {
  const canMutate = role !== "viewer";
  const [view, setView] = useState<View>("assigned_to_me");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [items, setItems] = useState<Task[] | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<
    "loading" | "forbidden" | "error" | "conflict" | null
  >("loading");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const result = await request<{ items: Task[]; assignees: Assignee[] }>(
        `/api/tasks?view=${view}&page=1&pageSize=25${includeArchived ? "&archived=include" : ""}`,
      );
      setItems(result.items);
      setAssignees(result.assignees ?? []);
      setState(null);
    } catch (error) {
      const reason = error as ApiError;
      setState(reason.status === 403 ? "forbidden" : "error");
      setMessage(reason.message);
    }
  }, [includeArchived, view]);

  useEffect(() => {
    // Synchronize the list with the selected server-side view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const showError = (error: unknown) => {
    const reason = error as ApiError;
    setFormError(reason);
    if (reason.status === 409) setMessage(reason.message);
  };
  const openTask = async (task: Task) => {
    setSelected(task);
    setEditing(false);
    setFormError(null);
    try {
      const result = await request<{ task: Task }>(
        `/api/tasks/${encodeURIComponent(task.id)}`,
      );
      setSelected(result.task);
    } catch (error) {
      showError(error);
    }
  };
  useEffect(() => {
    if (!initialTaskId) return;
    request<{ task: Task }>(`/api/tasks/${encodeURIComponent(initialTaskId)}`)
      .then(({ task }) => {
        setSelected(task);
        setEditing(false);
        setFormError(null);
      })
      .catch(showError);
  }, [initialTaskId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!form.title.trim() || !form.assigneeMembershipId || !form.dueAt) {
      setFormError({
        status: 400,
        message: "Complete the required task fields.",
      });
      return;
    }
    try {
      const result = selected
        ? await request<{ task: Task }>(
            `/api/tasks/${encodeURIComponent(selected.id)}`,
            {
              method: "PUT",
              body: JSON.stringify(toPayload(form, selected.version)),
            },
          )
        : await request<{ task: Task }>("/api/tasks", {
            method: "POST",
            body: JSON.stringify(toPayload(form)),
          });
      setSelected(result.task);
      setEditing(false);
      await load();
    } catch (error) {
      showError(error);
    }
  };
  const mutate = async (
    action: "complete" | "reopen" | "archive" | "restore",
  ) => {
    if (!selected) return;
    setFormError(null);
    try {
      const result = await request<{ task: Task }>(
        `/api/tasks/${encodeURIComponent(selected.id)}/${action}`,
        { method: "POST", body: JSON.stringify({ version: selected.version }) },
      );
      setSelected(result.task);
      await load();
    } catch (error) {
      showError(error);
    }
  };
  const beginCreate = () => {
    setSelected(null);
    setForm({ ...blankForm, assigneeMembershipId: assignees[0]?.id ?? "" });
    setFormError(null);
    setEditing(true);
  };

  if (state && !items)
    return (
      <StatePanel
        kind={state}
        title={
          state === "loading"
            ? "Loading tasks"
            : state === "forbidden"
              ? "Tasks are unavailable"
              : "Could not load tasks"
        }
        detail={message}
        action={
          state !== "loading" && (
            <button onClick={() => void load()}>Try again</button>
          )
        }
      />
    );

  return (
    <section className="tasks-page" aria-labelledby="tasks-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">Work queue</p>
          <h1 id="tasks-title">Tasks</h1>
          <p className="page-summary">
            Track the work that keeps customer relationships moving.
          </p>
        </div>
        {canMutate && <button onClick={beginCreate}>Create task</button>}
      </header>
      <div className="tasks-toolbar">
        <label>
          View
          <select
            aria-label="Task view"
            value={view}
            onChange={(event) => setView(event.target.value as View)}
          >
            <option value="assigned_to_me">Assigned to me</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <span className="utc-note">Due times shown in UTC</span>
        <label>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Include archived tasks
        </label>
      </div>
      {state === "error" && items && (
        <p className="tasks-inline-error" role="alert">
          {message}
        </p>
      )}
      {items?.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No tasks in this view"
          detail="Try another view or create a task."
        />
      ) : (
        <ul className="task-list" aria-label="Tasks">
          {items?.map((task) => (
            <li
              key={task.id}
              className={task.archivedAt ? "task archived" : "task"}
            >
              <button
                className="task-title"
                onClick={() => void openTask(task)}
              >
                {task.title}
              </button>
              <span>
                {task.assigneeName} · {task.priority}
              </span>
              <time dateTime={task.dueAt}>
                {task.dueAt.replace("T", " ").replace(".000Z", " UTC")}
              </time>
              <span className="task-status">{task.status}</span>
            </li>
          ))}
        </ul>
      )}
      {(selected || editing) && (
        <section className="task-detail" aria-labelledby="task-detail-title">
          <div className="task-detail-heading">
            <h2 id="task-detail-title">
              {selected ? "Task details" : "Create task"}
            </h2>
            <button
              onClick={() => {
                setSelected(null);
                setEditing(false);
              }}
            >
              Close
            </button>
          </div>
          {selected && !editing && (
            <div className="task-facts">
              <p>{selected.description || "No description."}</p>
              <dl>
                <dt>Assignee</dt>
                <dd>{selected.assigneeName}</dd>
                <dt>Due</dt>
                <dd>{selected.dueAt} UTC</dd>
                <dt>Version</dt>
                <dd>{selected.version}</dd>
              </dl>
            </div>
          )}
          {canMutate && selected && !editing && (
            <div className="task-actions">
              {selected.status === "completed" ? (
                <button onClick={() => void mutate("reopen")}>Reopen</button>
              ) : (
                <button onClick={() => void mutate("complete")}>
                  Complete
                </button>
              )}
              {selected.archivedAt ? (
                <button onClick={() => void mutate("restore")}>Restore</button>
              ) : (
                <button onClick={() => void mutate("archive")}>Archive</button>
              )}
              <button
                onClick={() => {
                  setForm(formFromTask(selected));
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
          {editing && (
            <form className="task-form" onSubmit={save}>
              <label>
                Title *
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <label>
                Assignee *
                <select
                  required
                  value={form.assigneeMembershipId}
                  onChange={(e) =>
                    setForm({ ...form, assigneeMembershipId: e.target.value })
                  }
                >
                  <option value="">Choose an assignee</option>
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due time (UTC) *
                <input
                  required
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                />
              </label>
              <label>
                Priority
                <select
                  value={form.priority}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      priority: e.target.value as Task["priority"],
                    })
                  }
                >
                  <option>low</option>
                  <option>medium</option>
                  <option>high</option>
                  <option>urgent</option>
                </select>
              </label>
              <label>
                Company ID (optional)
                <input
                  value={form.companyId}
                  onChange={(e) =>
                    setForm({ ...form, companyId: e.target.value })
                  }
                />
              </label>
              <label>
                Contact ID (optional)
                <input
                  value={form.contactId}
                  onChange={(e) =>
                    setForm({ ...form, contactId: e.target.value })
                  }
                />
              </label>
              <label>
                Deal ID (optional)
                <input
                  value={form.dealId}
                  onChange={(e) => setForm({ ...form, dealId: e.target.value })}
                />
              </label>
              {formError && (
                <div role="alert" className="form-error">
                  {formError.message}
                  {formError.issues?.map((issue) => (
                    <div key={issue}>{issue}</div>
                  ))}
                </div>
              )}
              <div className="task-actions">
                <button type="submit">
                  {selected ? "Save task" : "Create task"}
                </button>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {formError && !editing && (
            <p role="alert" className="form-error">
              {formError.message}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
