import { useCallback, useEffect, useState } from "react";
import { StatePanel } from "../ui/StatePanel";
import "./dashboard.css";

type Money = { currency: string; amountMinor: string };
type Dashboard = {
  asOf: string;
  semantics: {
    recentFrom: string;
    upcomingTo: string;
    closeFrom: string;
    closeTo: string;
    staleBefore: string;
    trendFrom: string;
    trendTo: string;
  };
  openPipeline: { count: number; totals: Money[] };
  stageDistribution: Array<{
    id: string;
    name: string;
    count: number;
    totals: Money[];
  }>;
  outcomeTrend: Array<{
    month: string;
    from: string;
    to: string;
    won: number;
    lost: number;
  }>;
  recentActivity: {
    count: number;
    items: Array<{
      id: string;
      type: string;
      subject: string;
      occurredAt: string;
      creatorLabel: string;
      companyLabel: string | null;
    }>;
  };
  tasks: { overdue: number; upcoming: number };
  closingSoon: { count: number; totals: Money[] };
  staleAccounts: { count: number };
};

const emptyDashboard: Dashboard = {
  asOf: new Date(0).toISOString(),
  semantics: {
    recentFrom: "",
    upcomingTo: "",
    closeFrom: "",
    closeTo: "",
    staleBefore: "",
    trendFrom: "",
    trendTo: "",
  },
  openPipeline: { count: 0, totals: [] },
  stageDistribution: [],
  outcomeTrend: [],
  recentActivity: { count: 0, items: [] },
  tasks: { overdue: 0, upcoming: 0 },
  closingSoon: { count: 0, totals: [] },
  staleAccounts: { count: 0 },
};

export function DashboardPage({ userName = "" }: { userName?: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard", { signal });
      const body = (await response.json().catch(() => null)) as
        Dashboard | { error?: string } | null;
      if (!response.ok) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "The dashboard could not be loaded.",
        );
      }
      if (!isDashboard(body))
        throw new Error("The dashboard response was incomplete.");
      setDashboard(body);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError")
        return;
      setError(
        reason instanceof Error
          ? reason.message
          : "The dashboard could not be loaded.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Fetching is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error && !dashboard) {
    return (
      <StatePanel
        kind="error"
        title="Could not load your dashboard"
        detail={error}
        action={<button onClick={() => void load()}>Try again</button>}
      />
    );
  }
  if (loading && !dashboard) {
    return <StatePanel kind="loading" title="Loading your dashboard" />;
  }

  const data = dashboard ?? emptyDashboard;
  const firstName = userName.trim().split(/\s+/)[0];
  const asOf = data.asOf ? new Date(data.asOf) : new Date();
  return (
    <div className="dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">
            {asOf.toLocaleDateString(undefined, { dateStyle: "full" })}
          </p>
          <h1>{firstName ? `Good morning, ${firstName}` : "Dashboard"}</h1>
          <p className="page-summary">
            A current view of your sales workspace.
          </p>
        </div>
        <button
          className="button-secondary"
          onClick={() => void load()}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <p className="dashboard-inline-error" role="alert">
          {error}
        </p>
      )}
      <section className="dashboard-metrics" aria-label="Sales overview">
        <MetricLink
          label="Open pipeline"
          href="#deals?status=open"
          value={data.openPipeline.count}
          totals={data.openPipeline.totals}
        />
        <MetricLink
          label="Deals closing soon"
          href={queryLink("deals", {
            status: "open",
            closeFrom: data.semantics.closeFrom,
            closeTo: data.semantics.closeTo,
          })}
          value={data.closingSoon.count}
          totals={data.closingSoon.totals}
        />
        <MetricLink
          label="Overdue tasks"
          href={queryLink("tasks", {
            view: "window",
            dueTo: data.asOf,
          })}
          value={data.tasks.overdue}
          note="Needs attention"
        />
        <MetricLink
          label="Stale accounts"
          href={queryLink("companies", {
            staleBefore: data.semantics.staleBefore,
            staleThrough: data.asOf,
          })}
          value={data.staleAccounts.count}
          note="No recent activity"
        />
      </section>

      <div className="dashboard-grid">
        <section
          className="surface dashboard-card"
          aria-labelledby="pipeline-title"
        >
          <SectionHeading
            eyebrow="Pipeline"
            title="Open pipeline by stage"
            linkHref="#deals?status=open"
            linkLabel="View deals"
          />
          {data.stageDistribution.length ? (
            <ul className="dashboard-list stage-list">
              {data.stageDistribution.map((stage) => (
                <li key={stage.id}>
                  <a
                    href={queryLink("deals", {
                      status: "open",
                      stageId: stage.id,
                    })}
                  >
                    <span>{stage.name}</span>
                    <strong>{stage.count}</strong>
                  </a>
                  <MoneyList totals={stage.totals} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyMessage detail="No open pipeline stages were returned." />
          )}
        </section>

        <section
          className="surface dashboard-card"
          aria-labelledby="trend-title"
        >
          <SectionHeading eyebrow="Outcomes" title="Won and lost by month" />
          {data.outcomeTrend.length ? (
            <ul className="dashboard-list trend-list">
              {data.outcomeTrend.map((month) => (
                <li key={month.month}>
                  <span>{monthLabel(month.month)}</span>
                  <span className="outcome-links">
                    <a
                      href={queryLink("deals", {
                        status: "won",
                        outcomeFrom: month.from,
                        outcomeTo: month.to,
                      })}
                    >
                      {month.won} won
                    </a>
                    <a
                      href={queryLink("deals", {
                        status: "lost",
                        outcomeFrom: month.from,
                        outcomeTo: month.to,
                      })}
                    >
                      {month.lost} lost
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyMessage detail="No outcome history is available yet." />
          )}
        </section>

        <section
          className="surface dashboard-card"
          aria-labelledby="activity-title"
        >
          <SectionHeading
            eyebrow="Recent activity"
            title={`${data.recentActivity.count} activities this week`}
            linkHref={queryLink("activities", {
              from: data.semantics.recentFrom,
              to: data.asOf,
            })}
            linkLabel="View activities"
          />
          {data.recentActivity.items.length ? (
            <ul className="dashboard-list activity-list">
              {data.recentActivity.items.map((activity) => (
                <li key={activity.id}>
                  <span className="activity-type">{activity.type}</span>
                  <strong>{activity.subject}</strong>
                  <small>
                    {activity.companyLabel ?? "Workspace"} ·{" "}
                    {activity.creatorLabel} · {formatDate(activity.occurredAt)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyMessage detail="No activity was recorded in the recent period." />
          )}
        </section>

        <section
          className="surface dashboard-card attention-card"
          aria-labelledby="attention-title"
        >
          <SectionHeading
            eyebrow="Follow-up"
            title="Tasks and accounts needing attention"
          />
          <ul className="dashboard-list attention-list">
            <li>
              <a
                href={queryLink("tasks", {
                  view: "window",
                  dueTo: data.asOf,
                })}
              >
                <span>Overdue tasks</span>
                <strong>{data.tasks.overdue}</strong>
              </a>
            </li>
            <li>
              <a
                href={queryLink("tasks", {
                  view: "window",
                  dueFrom: data.asOf,
                  dueTo: data.semantics.upcomingTo,
                })}
              >
                <span>Upcoming tasks</span>
                <strong>{data.tasks.upcoming}</strong>
              </a>
            </li>
            <li>
              <a
                href={queryLink("deals", {
                  status: "open",
                  closeFrom: data.semantics.closeFrom,
                  closeTo: data.semantics.closeTo,
                })}
              >
                <span>Closing soon</span>
                <strong>{data.closingSoon.count}</strong>
                <MoneyList totals={data.closingSoon.totals} />
              </a>
            </li>
            <li>
              <a
                href={queryLink("companies", {
                  staleBefore: data.semantics.staleBefore,
                  staleThrough: data.asOf,
                })}
              >
                <span>Stale accounts</span>
                <strong>{data.staleAccounts.count}</strong>
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function MetricLink({
  label,
  href,
  value,
  totals,
  note,
}: {
  label: string;
  href: string;
  value: number;
  totals?: Money[];
  note?: string;
}) {
  return (
    <article className="dashboard-metric">
      <a href={href}>
        <span>{label}</span>
        <strong>{value}</strong>
        {totals?.length ? <MoneyList totals={totals} /> : <small>{note}</small>}
      </a>
    </article>
  );
}

function SectionHeading({
  eyebrow,
  title,
  linkHref,
  linkLabel,
}: {
  eyebrow: string;
  title: string;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {linkHref && linkLabel && <a href={linkHref}>{linkLabel}</a>}
    </div>
  );
}

function MoneyList({ totals }: { totals: Money[] }) {
  return (
    <span className="money-list">
      {totals.map((money) => (
        <span key={money.currency}>{formatMoney(money)}</span>
      ))}
    </span>
  );
}

function EmptyMessage({ detail }: { detail: string }) {
  return <p className="dashboard-empty">{detail}</p>;
}

function formatMoney(money: Money) {
  const value = BigInt(money.amountMinor);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    const whole = value / 100n;
    const fraction = String(value % 100n).padStart(2, "0");
    return `${money.currency} ${whole.toLocaleString()}.${fraction}`;
  }
  const amount = Number(value) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: money.currency,
  }).format(amount);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function monthLabel(value: string) {
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function queryLink(route: string, values: Record<string, string>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value) query.set(key, value);
  return `#${route}${query.toString() ? `?${query}` : ""}`;
}

function isDashboard(value: unknown): value is Dashboard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dashboard>;
  return Boolean(
    candidate.semantics &&
    candidate.openPipeline &&
    candidate.stageDistribution &&
    candidate.outcomeTrend &&
    candidate.recentActivity &&
    candidate.tasks &&
    candidate.closingSoon &&
    candidate.staleAccounts,
  );
}
