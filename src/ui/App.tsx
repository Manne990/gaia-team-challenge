import { useState } from 'react';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, ToastRegion } from './states';

export type UserRole = 'owner' | 'member' | 'viewer';

type NavigationItem = { label: string; detail: string; ownerOnly?: boolean };

const navigation: NavigationItem[] = [
  { label: 'Dashboard', detail: 'Today’s revenue and follow-up work' },
  { label: 'Companies', detail: 'Accounts and customer organizations' },
  { label: 'Contacts', detail: 'People and relationships' },
  { label: 'Activities', detail: 'Calls, notes, meetings, and emails' },
  { label: 'Deals', detail: 'Pipeline and opportunities' },
  { label: 'Tasks', detail: 'Assigned and scheduled work' },
  { label: 'Imports', detail: 'Import and export data' },
  { label: 'Audit', detail: 'Organization activity history' },
  {
    label: 'Administration',
    detail: 'Members and organization settings',
    ownerOnly: true,
  },
];

export function App({ role = 'owner' }: { role?: UserRole }) {
  const [activePage, setActivePage] = useState('Dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const items = navigation.filter((item) => !item.ownerOnly || role === 'owner');
  const active = items.find((item) => item.label === activePage) ?? items[0];
  const canCreate = role !== 'viewer';

  function choosePage(label: string) {
    setActivePage(label);
    setMenuOpen(false);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar">
        <button
          className="menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
        <a className="brand" href="#dashboard" onClick={() => choosePage('Dashboard')}>
          Northstar <span>CRM</span>
        </a>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Open notifications"
            onClick={() => setNotice('You have no unread notifications.')}
          >
            Notifications
          </button>
          <button className="user-menu" type="button" aria-label="Open account menu">
            Alex Morgan <span aria-hidden="true">⌄</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="CRM navigation">
          <nav id="main-navigation" aria-label="CRM navigation">
            <p className="organization-name">Northstar Demo</p>
            <ul>
              {items.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    aria-current={active.label === item.label ? 'page' : undefined}
                    onClick={() => choosePage(item.label)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="sidebar-footer">
            <span className="role-badge">{role}</span>
            <span>Signed in as Alex</span>
          </div>
        </aside>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <section className="page-header" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">Northstar Demo</p>
              <h1 id="page-title">{active.label}</h1>
              <p>{active.detail}</p>
            </div>
            {canCreate ? (
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  setNotice(
                    `Create ${active.label.toLowerCase()} is ready for the connected data workflow.`,
                  )
                }
              >
                Create {active.label === 'Dashboard' ? 'record' : active.label.slice(0, -1)}
              </button>
            ) : (
              <span className="read-only-note">Viewer access · read only</span>
            )}
          </section>
          {active.label === 'Dashboard' ? (
            <Dashboard onConfirm={() => setDialogOpen(true)} />
          ) : (
            <WorkspacePage page={active.label} />
          )}
        </main>
      </div>
      <ToastRegion message={notice} onDismiss={() => setNotice(null)} />
      <ConfirmDialog
        open={dialogOpen}
        title="Mark weekly review complete?"
        description="This will add a completion activity visible to your team."
        confirmLabel="Mark complete"
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setDialogOpen(false);
          setNotice('Weekly review marked complete.');
        }}
      />
    </div>
  );
}

function Dashboard({ onConfirm }: { onConfirm: () => void }) {
  return (
    <>
      <section className="metric-grid" aria-label="Dashboard metrics">
        <Metric label="Open pipeline" value="$184,500" trend="12% from last month" />
        <Metric label="Deals closing soon" value="8" trend="3 need attention" />
        <Metric label="Tasks due today" value="6" trend="2 overdue" warn />
        <Metric label="Recent activity" value="24" trend="Across 14 accounts" />
      </section>
      <section className="dashboard-grid">
        <article className="data-panel">
          <div className="panel-heading">
            <div>
              <h2>Follow-up work</h2>
              <p>Prioritized by due date</p>
            </div>
            <button className="text-button" type="button" onClick={onConfirm}>
              Complete review
            </button>
          </div>
          <TaskTable />
        </article>
        <article className="data-panel">
          <div className="panel-heading">
            <div>
              <h2>Pipeline by stage</h2>
              <p>Current open value</p>
            </div>
            <button className="text-button" type="button">
              View deals
            </button>
          </div>
          <StageList />
        </article>
      </section>
    </>
  );
}

function WorkspacePage({ page }: { page: string }) {
  return (
    <section className="data-panel">
      <div className="panel-heading">
        <div>
          <h2>{page} workspace</h2>
          <p>Filters and saved views will preserve your working context.</p>
        </div>
        <button className="secondary-button" type="button">
          Filter
        </button>
      </div>
      <EmptyState
        title={`No ${page.toLowerCase()} selected`}
        description="Choose a saved view or create a record to begin working here."
        actionLabel={`Create ${page === 'Activities' ? 'activity' : page.slice(0, -1).toLowerCase()}`}
      />
    </section>
  );
}

function Metric({
  label,
  value,
  trend,
  warn = false,
}: {
  label: string;
  value: string;
  trend: string;
  warn?: boolean;
}) {
  return (
    <article className="metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <span className={warn ? 'warning-text' : 'muted'}>{trend}</span>
    </article>
  );
}

function TaskTable() {
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Upcoming follow-up tasks</caption>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Account</th>
            <th scope="col">Due</th>
            <th scope="col">Owner</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a href="#task-1">Send proposal follow-up</a>
            </td>
            <td>Northwind Trading</td>
            <td className="warning-text">Today, 15:00</td>
            <td>Alex Morgan</td>
          </tr>
          <tr>
            <td>
              <a href="#task-2">Prepare renewal notes</a>
            </td>
            <td>Acme Industries</td>
            <td>Tomorrow</td>
            <td>Sam Lee</td>
          </tr>
          <tr>
            <td>
              <a href="#task-3">Schedule discovery call</a>
            </td>
            <td>Brightworks</td>
            <td>Thu, 10:00</td>
            <td>Alex Morgan</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StageList() {
  return (
    <ul className="stage-list">
      <li>
        <span>Discovery</span>
        <strong>$48,000</strong>
        <progress value="26" max="100">
          26%
        </progress>
      </li>
      <li>
        <span>Proposal</span>
        <strong>$72,500</strong>
        <progress value="39" max="100">
          39%
        </progress>
      </li>
      <li>
        <span>Negotiation</span>
        <strong>$64,000</strong>
        <progress value="35" max="100">
          35%
        </progress>
      </li>
    </ul>
  );
}

export { EmptyState, ErrorState, LoadingState };
