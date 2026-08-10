import { useState } from "react";
import { ConfirmationDialog } from "../App";
import { StatePanel } from "../ui/StatePanel";
import { Toast } from "../ui/Toast";

const deals = [
  {
    name: "Acme renewal",
    company: "Acme AB",
    stage: "Proposal",
    value: "$48,000",
    close: "Aug 18",
    owner: "Alex M.",
  },
  {
    name: "Northwind rollout",
    company: "Northwind",
    stage: "Discovery",
    value: "$31,500",
    close: "Aug 24",
    owner: "Sam K.",
  },
  {
    name: "Orbit expansion",
    company: "Orbit Systems",
    stage: "Negotiation",
    value: "$72,000",
    close: "Sep 02",
    owner: "Alex M.",
  },
  {
    name: "Harbor onboarding",
    company: "Harbor Studio",
    stage: "Qualified",
    value: "$19,800",
    close: "Sep 06",
    owner: "Jamie L.",
  },
];

export function DashboardPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState(false);
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Monday, 10 August</p>
          <h1>Good morning, Alex</h1>
          <p className="page-summary">
            Here is what needs attention across your sales workspace.
          </p>
        </div>
        <div className="header-actions">
          <button className="button-secondary">Import</button>
          <button onClick={() => setDialogOpen(true)}>Create deal</button>
        </div>
      </header>

      <section className="metrics" aria-label="Sales overview">
        <Metric
          label="Open pipeline"
          value="$482k"
          note="12% from last month"
          tone="positive"
        />
        <Metric label="Deals closing soon" value="8" note="$126k expected" />
        <Metric
          label="Overdue tasks"
          value="5"
          note="2 high priority"
          tone="warning"
        />
        <Metric
          label="Stale accounts"
          value="14"
          note="No activity in 30 days"
        />
      </section>

      <div className="content-grid">
        <section
          className="surface pipeline-panel"
          aria-labelledby="pipeline-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Pipeline</p>
              <h2 id="pipeline-title">Deals requiring attention</h2>
            </div>
            <a href="#deals">
              View pipeline <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="filter-bar" aria-label="Deal filters">
            <label>
              <span className="sr-only">Search deals</span>
              <input type="search" placeholder="Search deals" />
            </label>
            <label>
              <span>Stage</span>
              <select defaultValue="all">
                <option value="all">All stages</option>
                <option>Proposal</option>
                <option>Negotiation</option>
              </select>
            </label>
            <button className="button-secondary">
              More filters <span className="count-badge">2</span>
            </button>
            <button className="button-quiet">Clear all</button>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            aria-label="Scrollable deal table"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <input type="checkbox" aria-label="Select all deals" />
                  </th>
                  <th scope="col">Deal</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Value</th>
                  <th scope="col">Close date</th>
                  <th scope="col">Owner</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.name}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${deal.name}`}
                      />
                    </td>
                    <th scope="row">
                      <a href="#deals">{deal.name}</a>
                      <small>{deal.company}</small>
                    </th>
                    <td>
                      <span className="status-badge">{deal.stage}</span>
                    </td>
                    <td className="numeric">{deal.value}</td>
                    <td>{deal.close}</td>
                    <td>{deal.owner}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Actions for ${deal.name}`}
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="table-footer">
            <span>Showing 1–4 of 24 deals</span>
            <div>
              <button className="button-secondary" disabled>
                Previous
              </button>
              <button className="button-secondary">Next</button>
            </div>
          </footer>
        </section>

        <aside className="side-stack">
          <section className="surface" aria-labelledby="tasks-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Follow-up</p>
                <h2 id="tasks-title">Today’s tasks</h2>
              </div>
              <a href="#tasks">View all</a>
            </div>
            <ul className="task-list">
              <Task
                title="Call Acme procurement"
                meta="Due 09:30 · High"
                urgent
              />
              <Task title="Review Orbit proposal" meta="Due 13:00 · Alex M." />
              <Task title="Prepare Northwind demo" meta="Due 16:30 · Sam K." />
            </ul>
          </section>
          <section
            className="surface state-sample"
            aria-labelledby="states-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Reusable state</p>
                <h2 id="states-title">No saved views yet</h2>
              </div>
            </div>
            <StatePanel
              kind="empty"
              compact
              title="Create a saved view"
              detail="Keep a useful filter combination ready for next time."
              action={
                <button
                  className="button-secondary"
                  onClick={() => setToast(true)}
                >
                  Save current view
                </button>
              }
            />
          </section>
        </aside>
      </div>
      {toast && (
        <Toast
          message="View saved for this workspace"
          onDismiss={() => setToast(false)}
        />
      )}
      <ConfirmationDialog
        open={dialogOpen}
        title="Create a new deal?"
        detail="A draft deal will be added to Northstar Demo. You can complete its details next."
        confirmLabel="Create deal"
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setDialogOpen(false);
          setToast(true);
        }}
      />
    </>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "positive" | "warning";
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={tone ? `tone-${tone}` : undefined}>{note}</small>
    </article>
  );
}

function Task({
  title,
  meta,
  urgent = false,
}: {
  title: string;
  meta: string;
  urgent?: boolean;
}) {
  return (
    <li>
      <input type="checkbox" aria-label={`Complete ${title}`} />
      <span>
        <strong>{title}</strong>
        <small className={urgent ? "tone-warning" : undefined}>{meta}</small>
      </span>
      <button className="icon-button" aria-label={`Actions for ${title}`}>
        ⋯
      </button>
    </li>
  );
}
