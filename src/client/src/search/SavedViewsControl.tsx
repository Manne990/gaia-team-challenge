import { useState } from "react";

type SavedView = {
  id: string;
  resource: string;
  name: string;
  state: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;
  invalid?: boolean;
};
type Props = {
  resource: string;
  state: Record<string, string>;
  onApply: (state: Record<string, string>) => void;
};
type ApiError = { error?: string; issues?: string[] };

function isObjectState(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = (await response.json().catch(() => ({}))) as ApiError & T;
  if (!response.ok)
    throw new Error(
      [body.error, ...(body.issues ?? [])].filter(Boolean).join(" ") ||
        "The request could not be completed.",
    );
  return body as T;
}

export function SavedViewsControl({ resource, state, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const selected = views.find((view) => view.id === selectedId);

  async function loadViews() {
    if (status !== "idle") return;
    setStatus("loading");
    try {
      const data = await request<{
        items?: Array<Omit<SavedView, "state"> & { state: unknown }>;
      }>(`/api/saved-views?resource=${encodeURIComponent(resource)}`);
      setViews(
        (data.items ?? []).filter(
          (view): view is SavedView =>
            isObjectState(view.state) && !view.invalid,
        ),
      );
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Saved views could not be loaded.",
      );
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setMessage("Enter a name for this view.");
    try {
      const createdResponse = await request<{ view: SavedView }>(
        "/api/saved-views",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource, name: trimmed, state }),
        },
      );
      const created = createdResponse.view;
      if (!isObjectState(created.state))
        return setMessage(
          "The saved view had an invalid state and was ignored.",
        );
      setViews((current) => [...current, created]);
      setSelectedId(created.id);
      setName("");
      setMessage("View saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "View could not be saved.",
      );
    }
  }
  async function update() {
    if (!selected) return;
    try {
      const updatedResponse = await request<{ view: SavedView }>(
        `/api/saved-views/${encodeURIComponent(selected.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: selected.name,
            state,
            version: selected.version,
          }),
        },
      );
      const updated = updatedResponse.view;
      if (!isObjectState(updated.state))
        return setMessage(
          "The saved view had an invalid state and was ignored.",
        );
      setViews((current) =>
        current.map((view) => (view.id === updated.id ? updated : view)),
      );
      setMessage("View updated.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "View could not be updated.",
      );
    }
  }
  async function remove() {
    if (!selected) return;
    try {
      await request<void>(
        `/api/saved-views/${encodeURIComponent(selected.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: selected.version }),
        },
      );
      setViews((current) => current.filter((view) => view.id !== selected.id));
      setSelectedId("");
      setMessage("View deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "View could not be deleted.",
      );
    }
  }
  return (
    <section className="saved-views" aria-labelledby="saved-views-title">
      <h2 id="saved-views-title">Saved views</h2>
      {status === "loading" && <p aria-live="polite">Loading saved views…</p>}
      {status === "error" && <p role="alert">{message}</p>}
      <div className="saved-view-row">
        <label htmlFor="saved-view-select">Your views</label>
        <select
          id="saved-view-select"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          disabled={status === "loading" || status === "error"}
          onFocus={() => void loadViews()}
        >
          <option value="">Select a view</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            selected && isObjectState(selected.state) && onApply(selected.state)
          }
          disabled={!selected}
        >
          Apply
        </button>
      </div>
      {selected && (
        <div className="saved-view-actions">
          <label htmlFor="saved-view-name">Selected view name</label>
          <input
            id="saved-view-name"
            value={selected.name}
            onChange={(event) =>
              setViews((current) =>
                current.map((view) =>
                  view.id === selected.id
                    ? { ...view, name: event.target.value }
                    : view,
                ),
              )
            }
          />
          <button type="button" onClick={() => void update()}>
            Rename and update
          </button>
          <button
            type="button"
            className="button-danger"
            onClick={() => void remove()}
          >
            Delete
          </button>
        </div>
      )}
      <div className="saved-view-save">
        <label htmlFor="new-saved-view-name">Save current view</label>
        <input
          id="new-saved-view-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="button" onClick={() => void save()}>
          Save view
        </button>
      </div>
      {message && (
        <p className="saved-view-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
