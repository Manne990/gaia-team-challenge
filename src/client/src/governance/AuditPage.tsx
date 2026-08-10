import { FormEvent, useCallback, useEffect, useState } from "react";
import "./governance.css";

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorMembershipId: string;
  actorName: string | null;
  summary: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
};
type AuditResponse = {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
const formatUtc = (value: string) =>
  `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;

async function request<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new Error("The network request failed. Try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? "The request could not be completed.");
  return body as T;
}

export function AuditPage() {
  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    actorMembershipId: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (value.trim()) query.set(key, value.trim());
    });
    try {
      setResult(await request<AuditResponse>(`/api/audit?${query}`));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load audit history.",
      );
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page]);
  useEffect(() => {
    // Reload whenever the selected query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters(filters);
  };
  const clear = () => {
    const cleared = { action: "", entityType: "", actorMembershipId: "" };
    setFilters(cleared);
    setAppliedFilters(cleared);
    setPage(1);
  };
  return (
    <section className="governance-page" aria-labelledby="audit-title">
      <header className="governance-header">
        <div>
          <p className="eyebrow">Accountability</p>
          <h1 id="audit-title">Audit history</h1>
          <p>Review organization activity. Times are shown in UTC.</p>
        </div>
      </header>
      <section
        className="governance-card"
        aria-labelledby="audit-filters-title"
      >
        <h2 id="audit-filters-title">Filters</h2>
        <form className="governance-toolbar" onSubmit={apply}>
          <label htmlFor="audit-action">
            Action
            <input
              id="audit-action"
              value={filters.action}
              onChange={(event) =>
                setFilters({ ...filters, action: event.target.value })
              }
            />
          </label>
          <label htmlFor="audit-entity-type">
            Entity type
            <input
              id="audit-entity-type"
              value={filters.entityType}
              onChange={(event) =>
                setFilters({ ...filters, entityType: event.target.value })
              }
            />
          </label>
          <label htmlFor="audit-actor">
            Actor membership ID
            <input
              id="audit-actor"
              value={filters.actorMembershipId}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  actorMembershipId: event.target.value,
                })
              }
            />
          </label>
          <button type="submit">Apply filters</button>
          <button type="button" onClick={clear}>
            Clear
          </button>
        </form>
      </section>
      {loading && (
        <div className="governance-state" role="status">
          Loading audit history…
        </div>
      )}
      {!loading && error && (
        <div className="governance-state governance-error" role="alert">
          <h2>Could not load audit history</h2>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!loading && !error && result?.items.length === 0 && (
        <div className="governance-state">
          <h2>No audit events found</h2>
          <p>Try changing or clearing the filters.</p>
        </div>
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <>
          <ul className="audit-list">
            {result.items.map((item) => (
              <li className="audit-item" key={item.id}>
                <header>
                  <div>
                    <strong>{item.action}</strong>
                    <div className="audit-meta">
                      {item.entityType} · {item.entityId} ·{" "}
                      {item.actorName ?? "System"}
                    </div>
                  </div>
                  <time dateTime={item.occurredAt}>
                    {formatUtc(item.occurredAt)}
                  </time>
                </header>
                <pre className="audit-summary">
                  {JSON.stringify(item.summary, null, 2)}
                </pre>
                <div className="audit-meta">
                  Correlation ID: <code>{item.correlationId}</code>
                </div>
              </li>
            ))}
          </ul>
          <nav className="pagination" aria-label="Audit pagination">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {result.page} of {result.totalPages} ({result.total} events)
            </span>
            <button
              type="button"
              disabled={page >= result.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
