import { FormEvent, useCallback, useEffect, useState } from "react";
import { StatePanel } from "../ui/StatePanel";
import "./deals.css";

export type DealRole = "owner" | "member" | "viewer";
export type DealStatus = "open" | "won" | "lost";
export interface DealStage {
  id: string;
  name: string;
  position?: number;
  kind: "open" | "won" | "lost";
  active?: boolean | number;
  version: number;
}
export interface Deal {
  id: string;
  name: string;
  companyId?: string | null;
  companyName?: string | null;
  ownerMembershipId?: string | null;
  ownerName?: string | null;
  stageId: string;
  stageName?: string | null;
  amountMinor: number;
  currency: string;
  probability: number;
  expectedCloseDate?: string | null;
  status: DealStatus;
  lossReason?: string | null;
  archivedAt?: string | null;
  version: number;
  contactIds: string[];
  contacts?: Array<{ id: string; firstName: string; lastName: string }>;
  stageHistory?: Array<{
    id: string;
    fromStageName: string | null;
    toStageName: string;
    changedAt: string;
  }>;
  auditHistory?: Array<{ id: string; action: string; occurredAt: string }>;
}
interface DealList {
  items: Deal[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totals: {
    amountMinor: number | null;
    currency: string | null;
    byCurrency: Array<{ currency: string; amountMinor: number }>;
  };
  stages: DealStage[];
}
interface FormValues {
  name: string;
  companyId: string;
  ownerMembershipId: string;
  stageId: string;
  amountMinor: string;
  currency: string;
  probability: string;
  expectedCloseDate: string;
  contactIds: string;
}
const blankForm: FormValues = {
  name: "",
  companyId: "",
  ownerMembershipId: "",
  stageId: "",
  amountMinor: "",
  currency: "USD",
  probability: "",
  expectedCloseDate: "",
  contactIds: "",
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      0,
      "Northstar is temporarily unavailable. Check your connection and try again.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string } | string;
    message?: string;
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ??
            body.message ??
            "Something went wrong. Try again."),
    );
  return body as T;
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    minor / 100,
  );
const formFrom = (d: Deal): FormValues => ({
  name: d.name,
  companyId: d.companyId ?? "",
  ownerMembershipId: d.ownerMembershipId ?? "",
  stageId: d.stageId,
  amountMinor: String(d.amountMinor),
  currency: d.currency,
  probability: String(d.probability),
  expectedCloseDate: d.expectedCloseDate ?? "",
  contactIds: d.contactIds.join(", "),
});

export function DealsPage({ role }: { role: DealRole }) {
  const canEdit = role !== "viewer";
  const [list, setList] = useState<DealList | null>(null);
  const [query, setQuery] = useState("");
  const [stageId, setStageId] = useState("all");
  const [ownerId, setOwnerId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "pipeline">("table");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [transitionStage, setTransitionStage] = useState("");
  const [lossReason, setLossReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({
      page: String(page),
      pageSize: "20",
      includeArchived: String(includeArchived),
      sort: "expectedCloseDate",
      order: "asc",
    });
    if (query.trim()) p.set("q", query.trim());
    if (stageId !== "all") p.set("stageId", stageId);
    if (ownerId.trim()) p.set("ownerId", ownerId.trim());
    if (companyId.trim()) p.set("companyId", companyId.trim());
    if (status !== "all") p.set("status", status);
    try {
      setList(await request<DealList>(`/api/deals?${p}`));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [companyId, includeArchived, ownerId, page, query, stageId, status]);
  useEffect(() => {
    // Fetching is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const open = async (id: string) => {
    setSelected(null);
    setSaveError(null);
    try {
      const deal = (await request<{ deal: Deal }>(`/api/deals/${id}`)).deal;
      setSelected(deal);
      setTransitionStage(deal.stageId);
      setLossReason("");
    } catch (e) {
      setSaveError(errorText(e));
    }
  };
  const create = () => {
    setSelected(null);
    setForm({ ...blankForm, stageId: list?.stages[0]?.id ?? "" });
    setEditing(true);
    setSaveError(null);
  };
  const update = (key: keyof FormValues, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    const payload = {
      name: form.name,
      companyId: form.companyId || null,
      ownerMembershipId: form.ownerMembershipId || null,
      stageId: form.stageId,
      amountMinor: Number.parseInt(form.amountMinor, 10),
      currency: form.currency,
      probability: Number.parseInt(form.probability, 10),
      expectedCloseDate: form.expectedCloseDate || null,
      contactIds: form.contactIds
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      ...(selected ? { version: selected.version } : {}),
    };
    try {
      const result = selected
        ? await request<{ deal: Deal }>(`/api/deals/${selected.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : await request<{ deal: Deal }>("/api/deals", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      setSelected(result.deal);
      setTransitionStage(result.deal.stageId);
      setLossReason("");
      setEditing(false);
      await load();
    } catch (e) {
      setSaveError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const mutate = async (path: string, body?: object) => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await request<{ deal: Deal }>(
        `/api/deals/${selected.id}/${path}`,
        { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) },
      );
      setSelected(result.deal);
      await load();
    } catch (e) {
      setSaveError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const transition = () => {
    if (
      !selected ||
      !transitionStage ||
      (transitionStage !== selected.stageId &&
        list?.stages.find((s) => s.id === transitionStage)?.kind === "lost" &&
        !lossReason.trim())
    ) {
      setSaveError("A loss reason is required when moving a deal to Lost.");
      return;
    }
    void mutate("transition", {
      stageId: transitionStage,
      lossReason:
        list?.stages.find((stage) => stage.id === transitionStage)?.kind ===
        "lost"
          ? lossReason || null
          : null,
      version: selected.version,
    });
  };
  const stageList = list?.stages ?? [];
  return (
    <main className="deals-page" aria-labelledby="deals-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">Revenue</p>
          <h1 id="deals-title">Deals</h1>
          <p className="page-summary">
            Track opportunities from first conversation to close.
          </p>
        </div>
        {canEdit && <button onClick={create}>Create deal</button>}
      </header>
      <section className="surface deals-panel">
        <div className="filter-bar" aria-label="Deal filters">
          <label>
            <span className="sr-only">Search deals</span>
            <input
              type="search"
              placeholder="Search deals"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <span>Stage</span>
            <select
              aria-label="Stage"
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All stages</option>
              {stageList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Owner ID</span>
            <input
              aria-label="Owner ID"
              placeholder="Owner ID"
              value={ownerId}
              onChange={(e) => {
                setOwnerId(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <span className="sr-only">Company ID</span>
            <input
              aria-label="Company ID"
              placeholder="Company ID"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => {
                setIncludeArchived(e.target.checked);
                setPage(1);
              }}
            />{" "}
            Include archived
          </label>
          <div className="view-toggle" aria-label="Deal view">
            <button
              className={view === "table" ? "" : "button-secondary"}
              onClick={() => setView("table")}
            >
              Table
            </button>
            <button
              className={view === "pipeline" ? "" : "button-secondary"}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </button>
          </div>
        </div>
        {!loading && !error && list && (
          <div className="deal-totals" aria-label="Deal totals">
            <strong>{list.total} deals</strong>
            <span>
              Total pipeline:{" "}
              {list.totals.amountMinor !== null && list.totals.currency
                ? money(list.totals.amountMinor, list.totals.currency)
                : list.totals.byCurrency
                    .map((total) => money(total.amountMinor, total.currency))
                    .join(" + ")}
            </span>
          </div>
        )}
        {loading && (
          <StatePanel
            kind="loading"
            title="Loading deals"
            detail="Fetching your deal list…"
          />
        )}
        {!loading && Boolean(error) && (
          <StatePanel
            kind={
              error instanceof ApiError && error.status === 403
                ? "forbidden"
                : "error"
            }
            title="Could not load deals"
            detail={errorText(error)}
            action={
              <button className="button-secondary" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        )}
        {!loading && !error && list?.items.length === 0 && (
          <StatePanel
            kind="empty"
            title="No deals found"
            detail="Try changing your filters or create a deal."
            action={
              canEdit ? (
                <button onClick={create}>Create deal</button>
              ) : undefined
            }
          />
        )}
        {!loading &&
          !error &&
          list &&
          list.items.length > 0 &&
          (view === "table" ? (
            <DealTable items={list.items} open={open} />
          ) : (
            <Pipeline
              items={list.items}
              stages={stageList}
              open={open}
              canEdit={canEdit}
              onTransition={(d) => {
                setSelected(d);
                setTransitionStage(d.stageId);
              }}
            />
          ))}
        {!loading && !error && list && list.items.length > 0 && (
          <footer className="table-footer">
            <span>
              Showing {(list.page - 1) * list.pageSize + 1}–
              {Math.min(list.page * list.pageSize, list.total)} of {list.total}{" "}
              deals
            </span>
            <div>
              <button
                className="button-secondary"
                disabled={list.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                className="button-secondary"
                disabled={list.page >= list.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        )}
      </section>
      {role === "owner" && <StageConfig stages={stageList} reload={load} />}
      {(selected || editing) && (
        <div className="deal-backdrop" role="presentation">
          <section
            className="surface deal-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deal-detail-title"
          >
            <button
              className="button-quiet close-detail"
              aria-label="Close deal details"
              onClick={() => {
                setSelected(null);
                setEditing(false);
              }}
            >
              ×
            </button>
            {editing ? (
              <DealForm
                form={form}
                stages={stageList}
                onChange={update}
                onSubmit={save}
                saving={saving}
                error={saveError}
                onCancel={() => {
                  setEditing(false);
                  setSelected(null);
                }}
              />
            ) : (
              selected && (
                <>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Deal detail</p>
                      <h2 id="deal-detail-title">{selected.name}</h2>
                      <p>
                        {selected.companyName ??
                          selected.companyId ??
                          "No company"}{" "}
                        · {money(selected.amountMinor, selected.currency)}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        className="button-secondary"
                        onClick={() => {
                          setForm(formFrom(selected));
                          setEditing(true);
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <dl className="deal-facts">
                    <div>
                      <dt>Stage</dt>
                      <dd>{selected.stageName ?? selected.stageId}</dd>
                    </div>
                    <div>
                      <dt>Owner</dt>
                      <dd>
                        {selected.ownerName ??
                          selected.ownerMembershipId ??
                          "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{selected.status}</dd>
                    </div>
                    <div>
                      <dt>Expected close</dt>
                      <dd>{selected.expectedCloseDate ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Probability</dt>
                      <dd>{selected.probability}%</dd>
                    </div>
                    <div>
                      <dt>Contacts</dt>
                      <dd>{selected.contactIds.length || "—"}</dd>
                    </div>
                  </dl>
                  {canEdit && (
                    <div className="detail-actions">
                      <button
                        className="button-secondary"
                        onClick={() =>
                          void mutate(
                            selected.archivedAt ? "restore" : "archive",
                          )
                        }
                      >
                        {selected.archivedAt ? "Restore" : "Archive"}
                      </button>
                    </div>
                  )}
                  <div className="transition-box">
                    <h3>Change stage</h3>
                    <label>
                      New stage
                      <select
                        value={transitionStage || selected.stageId}
                        onChange={(e) => setTransitionStage(e.target.value)}
                      >
                        {stageList.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {list?.stages.find((s) => s.id === transitionStage)
                      ?.kind === "lost" && (
                      <label>
                        Loss reason
                        <input
                          value={lossReason}
                          onChange={(e) => setLossReason(e.target.value)}
                          required
                        />
                      </label>
                    )}
                    {canEdit && (
                      <button onClick={transition}>Transition</button>
                    )}
                  </div>
                  <div className="deal-history">
                    <h3>Stage history</h3>
                    {(selected.stageHistory ?? []).length ? (
                      <ol>
                        {selected.stageHistory!.map((entry) => (
                          <li key={entry.id}>
                            {entry.fromStageName ?? "Created"} →{" "}
                            {entry.toStageName}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No transitions recorded.</p>
                    )}
                    <h3>Change history</h3>
                    {(selected.auditHistory ?? []).length ? (
                      <ol>
                        {selected.auditHistory!.map((entry) => (
                          <li key={entry.id}>{entry.action}</li>
                        ))}
                      </ol>
                    ) : (
                      <p>No changes recorded.</p>
                    )}
                  </div>
                  {saveError && <p className="form-error">{saveError}</p>}
                </>
              )
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function DealTable({
  items,
  open,
}: {
  items: Deal[];
  open: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Deal</th>
            <th scope="col">Company</th>
            <th scope="col">Stage</th>
            <th scope="col">Owner</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <th scope="row">
                <button className="deal-link" onClick={() => void open(d.id)}>
                  {d.name}
                </button>
              </th>
              <td>{d.companyName ?? "—"}</td>
              <td>{d.stageName ?? d.stageId}</td>
              <td>{d.ownerName ?? "—"}</td>
              <td>{money(d.amountMinor, d.currency)}</td>
              <td>
                <span className="status-badge">{d.status}</span>
                {d.archivedAt && (
                  <small className="archived-label">Archived</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Pipeline({
  items,
  stages,
  open,
  canEdit,
  onTransition,
}: {
  items: Deal[];
  stages: DealStage[];
  open: (id: string) => void;
  canEdit: boolean;
  onTransition: (d: Deal) => void;
}) {
  return (
    <div className="pipeline">
      {stages
        .filter((s) => s.active !== false && s.active !== 0)
        .map((stage) => (
          <section
            className="pipeline-column"
            key={stage.id}
            aria-labelledby={`stage-${stage.id}`}
          >
            <h2 id={`stage-${stage.id}`}>
              {stage.name}
              <small>
                {items.filter((d) => d.stageId === stage.id).length}
              </small>
            </h2>
            {items
              .filter((d) => d.stageId === stage.id)
              .map((d) => (
                <article className="deal-card" key={d.id}>
                  <button className="deal-link" onClick={() => void open(d.id)}>
                    {d.name}
                  </button>
                  <p>{d.companyName ?? "No company"}</p>
                  <strong>{money(d.amountMinor, d.currency)}</strong>
                  {canEdit && (
                    <button
                      className="button-secondary transition-button"
                      onClick={() => onTransition(d)}
                    >
                      Change stage
                    </button>
                  )}
                </article>
              ))}
          </section>
        ))}
    </div>
  );
}
function DealForm({
  form,
  stages,
  onChange,
  onSubmit,
  saving,
  error,
  onCancel,
}: {
  form: FormValues;
  stages: DealStage[];
  onChange: (key: keyof FormValues, value: string) => void;
  onSubmit: (e: FormEvent) => void;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <form className="deal-form" onSubmit={onSubmit}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Deal editor</p>
          <h2 id="deal-detail-title">
            {form.name ? "Edit deal" : "Create deal"}
          </h2>
        </div>
      </div>
      {(
        [
          ["name", "Name"],
          ["companyId", "Company ID"],
          ["ownerMembershipId", "Owner membership ID"],
          ["amountMinor", "Amount (minor units)"],
          ["currency", "Currency"],
          ["probability", "Probability (%)"],
          ["expectedCloseDate", "Expected close date"],
          ["contactIds", "Contact IDs (comma separated)"],
        ] as Array<[keyof FormValues, string]>
      ).map(([key, label]) => (
        <label className="deal-field" key={key}>
          {label}
          <input
            required={
              key === "name" ||
              key === "amountMinor" ||
              key === "currency" ||
              key === "probability"
            }
            type={
              key === "amountMinor" || key === "probability"
                ? "number"
                : key === "expectedCloseDate"
                  ? "date"
                  : "text"
            }
            value={form[key]}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </label>
      ))}
      <label className="deal-field">
        Stage
        <select
          required
          value={form.stageId}
          onChange={(e) => onChange("stageId", e.target.value)}
        >
          <option value="">Choose a stage</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="detail-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save deal"}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function StageConfig({
  stages,
  reload,
}: {
  stages: DealStage[];
  reload: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState(String(stages.length));
  const [kind, setKind] = useState<DealStage["kind"]>("open");
  const [error, setError] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    try {
      await request("/api/pipeline/stages", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          position: Number(position),
          kind,
        }),
      });
      setName("");
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="surface stage-config">
      <button
        className="button-secondary"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
      >
        Stage configuration
      </button>
      {expanded && (
        <div>
          <h2>Manage pipeline stages</h2>
          <ul>
            {stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} reload={reload} />
            ))}
          </ul>
          <label>
            New stage
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Position
            <input
              type="number"
              min="0"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </label>
          <label>
            Outcome type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DealStage["kind"])}
            >
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          <button onClick={() => void add()}>Add stage</button>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </section>
  );
}

function StageRow({
  stage,
  reload,
}: {
  stage: DealStage;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState(stage.name),
    [position, setPosition] = useState(String(stage.position ?? 0));
  const [error, setError] = useState("");
  const change = async (path: string, body?: object) => {
    setError("");
    try {
      await request(`/api/pipeline/stages/${stage.id}${path}`, {
        method: path ? "POST" : "PUT",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await reload();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <li className="stage-row">
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Position
        <input
          type="number"
          min="0"
          value={position}
          onChange={(event) => setPosition(event.target.value)}
        />
      </label>
      <span>{stage.kind}</span>
      <button
        className="button-secondary"
        onClick={() =>
          void change("", {
            name,
            position: Number(position),
            kind: stage.kind,
            version: stage.version,
          })
        }
      >
        Save
      </button>
      <button
        className="button-secondary"
        onClick={() => void change("/deactivate")}
      >
        Deactivate
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
