import { useEffect, useState } from 'react';
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

export function App({
  role = 'owner',
  organizationName = 'Northstar Demo',
  displayName = 'Alex Morgan',
}: {
  role?: UserRole;
  organizationName?: string;
  displayName?: string;
}) {
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
            {displayName} <span aria-hidden="true">⌄</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="CRM navigation">
          <nav id="main-navigation" aria-label="CRM navigation">
            <p className="organization-name">{organizationName}</p>
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
              <p className="eyebrow">{organizationName}</p>
              <h1 id="page-title">{active.label}</h1>
              <p>{active.detail}</p>
            </div>
            {canCreate && active.label !== 'Companies' ? (
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  setNotice(
                    `Create ${active.label.toLowerCase()} is ready for the connected data workflow.`,
                  )
                }
              >
                Create {active.label === 'Dashboard' ? 'record' : singular(active.label)}
              </button>
            ) : (
              <span className="read-only-note">Viewer access · read only</span>
            )}
          </section>
          {active.label === 'Dashboard' ? (
            <Dashboard onConfirm={() => setDialogOpen(true)} onNavigate={choosePage} />
          ) : (
            <WorkspacePage page={active.label} role={role} />
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

type DashboardData = {
  openPipeline: { count: number; amountMinor: number };
  overdueTasks: number;
  upcomingTasks: number;
  recentActivity: Array<{ id: string }>;
  closingSoon: Array<{ id: string }>;
  stageDistribution: Array<{ id: string; name: string; count: number; amountMinor: number }>;
};

function Dashboard({
  onConfirm,
  onNavigate,
}: {
  onConfirm: () => void;
  onNavigate: (page: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/dashboard')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load dashboard data.');
        const value = (await response.json()) as DashboardData;
        if (!value.openPipeline || !Array.isArray(value.closingSoon))
          throw new Error('Could not load dashboard data.');
        setData(value);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Could not load dashboard data.'),
      );
  }, []);

  const dashboard =
    data ??
    ({
      openPipeline: { count: 0, amountMinor: 0 },
      overdueTasks: 0,
      upcomingTasks: 0,
      recentActivity: [],
      closingSoon: [],
      stageDistribution: [],
    } satisfies DashboardData);
  const money = (amountMinor: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
      amountMinor / 100,
    );
  return (
    <>
      <section className="metric-grid" aria-label="Dashboard metrics">
        <Metric
          label="Open pipeline"
          value={money(dashboard.openPipeline.amountMinor)}
          trend={`${dashboard.openPipeline.count} open deals`}
          onClick={() => onNavigate('Deals')}
        />
        <Metric
          label="Deals closing soon"
          value={`${dashboard.closingSoon.length}`}
          trend="Next 7 days"
          onClick={() => onNavigate('Deals')}
        />
        <Metric
          label="Follow-up work"
          value={`${dashboard.upcomingTasks}`}
          trend={`${dashboard.overdueTasks} overdue`}
          warn={dashboard.overdueTasks > 0}
          onClick={() => onNavigate('Tasks')}
        />
        <Metric
          label="Recent activity"
          value={`${dashboard.recentActivity.length}`}
          trend="Latest 10 entries"
          onClick={() => onNavigate('Activities')}
        />
      </section>
      {error ? <ErrorState title="Dashboard unavailable" description={error} /> : null}
      {!data && !error ? <LoadingState label="Loading dashboard" /> : null}
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
          <StageList stages={dashboard.stageDistribution} money={money} />
        </article>
      </section>
    </>
  );
}

const singular = (label: string) =>
  ({ Companies: 'company', Activities: 'activity', Audit: 'audit', Administration: 'member' })[
    label
  ] ?? label.slice(0, -1).toLowerCase();
function WorkspacePage({ page, role }: { page: string; role: UserRole }) {
  if (page === 'Tasks') return <TaskWorkspace />;
  if (page === 'Companies') return <CompanyWorkspace readOnly={role === 'viewer'} />;
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
        actionLabel={`Create ${singular(page)}`}
      />
    </section>
  );
}

function CompanyWorkspace({ readOnly }: { readOnly: boolean }) {
  const [items, setItems] = useState<Array<{ id: string; name: string; lifecycle_status: string }>>(
    [],
  );
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [lifecycleStatus, setLifecycleStatus] = useState('lead');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    void fetch('/api/companies')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load companies.');
        setItems(
          (
            (await response.json()) as {
              items: Array<{ id: string; name: string; lifecycle_status: string }>;
            }
          ).items,
        );
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Could not load companies.'),
      );
  useEffect(load, []);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, website, industry, lifecycleStatus }),
    });
    if (!response.ok) return setError('Could not create company.');
    setName('');
    setWebsite('');
    setIndustry('');
    setError(null);
    load();
  }
  return (
    <section className="data-panel" aria-label="Company records">
      <h2>Company records</h2>
      <form onSubmit={create}>
        <label>
          Company name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={readOnly}
          />
        </label>
        <label>
          Website
          <input
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Industry
          <input
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Lifecycle status
          <select
            value={lifecycleStatus}
            onChange={(event) => setLifecycleStatus(event.target.value)}
            disabled={readOnly}
          >
            <option value="lead">Lead</option>
            <option value="prospect">Prospect</option>
            <option value="customer">Customer</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={readOnly}>
          Create company
        </button>
      </form>
      {readOnly ? <p className="read-only-note">Viewer access · read only</p> : null}
      {error ? <ErrorState title="Companies unavailable" description={error} /> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} · {item.lifecycle_status}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskWorkspace() {
  type Task = {
    id: string;
    title: string;
    description: string;
    assigneeMembershipId: string;
    dueAt: string | null;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: 'open' | 'in_progress' | 'completed' | 'cancelled';
    companyId: string | null;
    contactId: string | null;
    dealId: string | null;
    version: number;
  };
  const [items, setItems] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [assigneeMembershipId, setAssigneeMembershipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const apiUrl = (path: string) => new URL(path, window.location.origin).toString();

  async function loadTasks() {
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/tasks'));
      if (!response.ok) throw new Error('Could not load tasks.');
      const data = (await response.json()) as { items: Task[]; actorMembershipId: string };
      setItems(data.items);
      setAssigneeMembershipId(data.actorMembershipId);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
  }, []);

  async function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !assigneeMembershipId) return;
    try {
      const response = await fetch(apiUrl('/api/tasks'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), assigneeMembershipId }),
      });
      if (!response.ok) throw new Error('Could not create task.');
      const created = (await response.json()) as Task;
      setItems((current) => [...current, created]);
      setTitle('');
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create task.');
    }
  }

  async function toggleTask(task: Task) {
    try {
      const status = task.status === 'completed' ? 'open' : 'completed';
      const response = await fetch(apiUrl(`/api/tasks/${task.id}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...task, status }),
      });
      if (!response.ok) throw new Error('Could not update task.');
      const updated = (await response.json()) as Task;
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update task.');
    }
  }
  return (
    <section className="data-panel">
      <div className="panel-heading">
        <div>
          <h2>Task workspace</h2>
          <p>Due-state views use UTC.</p>
        </div>
      </div>
      <form className="task-form" onSubmit={addTask}>
        <label>
          Task title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <button className="primary-button" type="submit">
          Add task
        </button>
      </form>
      {error ? <ErrorState title="Task workspace unavailable" description={error} /> : null}
      {loading ? <LoadingState label="Loading tasks" /> : null}
      <ul className="task-list">
        {items.map((item) => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.status === 'completed'}
                onChange={() => void toggleTask(item)}
              />{' '}
              <span>{item.title}</span>
            </label>
            <small>
              {item.status === 'completed' ? 'Completed' : (item.dueAt ?? 'No due date')}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Metric({
  label,
  value,
  trend,
  warn = false,
  onClick,
}: {
  label: string;
  value: string;
  trend: string;
  warn?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className="metric" type="button" onClick={onClick} aria-label={`View ${label}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span className={warn ? 'warning-text' : 'muted'}>{trend}</span>
    </button>
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

function StageList({
  stages,
  money,
}: {
  stages: DashboardData['stageDistribution'];
  money: (amountMinor: number) => string;
}) {
  const total = stages.reduce((sum, stage) => sum + stage.amountMinor, 0);
  return (
    <ul className="stage-list">
      {stages.map((stage) => {
        const percent = total ? Math.round((stage.amountMinor / total) * 100) : 0;
        return (
          <li key={stage.id}>
            <span>{stage.name}</span>
            <strong>{money(stage.amountMinor)}</strong>
            <progress value={percent} max="100">
              {percent}%
            </progress>
          </li>
        );
      })}
    </ul>
  );
}

export { EmptyState, ErrorState, LoadingState };
