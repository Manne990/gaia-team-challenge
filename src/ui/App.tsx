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
  const active =
    items.find(
      (item) =>
        item.label === activePage ||
        (activePage === 'Deals closing soon' && item.label === 'Deals') ||
        (activePage === 'Recent activity' && item.label === 'Activities') ||
        (activePage === 'Tasks follow-up' && item.label === 'Tasks'),
    ) ?? items[0];
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
          {activePage === 'Dashboard' ? (
            <Dashboard onConfirm={() => setDialogOpen(true)} onNavigate={choosePage} />
          ) : (
            <WorkspacePage page={activePage} role={role} />
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
  followUpTasks: Array<{
    id: string;
    title: string;
    dueAt: string;
    priority: string;
    companyName: string;
    assigneeName: string;
  }>;
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
      followUpTasks: [],
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
          onClick={() => onNavigate('Deals closing soon')}
        />
        <Metric
          label="Follow-up work"
          value={`${dashboard.upcomingTasks}`}
          trend={`${dashboard.overdueTasks} overdue`}
          warn={dashboard.overdueTasks > 0}
          onClick={() => onNavigate('Tasks follow-up')}
        />
        <Metric
          label="Recent activity"
          value={`${dashboard.recentActivity.length}`}
          trend="Latest 10 entries"
          onClick={() => onNavigate('Recent activity')}
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
          <TaskTable tasks={dashboard.followUpTasks} />
        </article>
        <article className="data-panel">
          <div className="panel-heading">
            <div>
              <h2>Pipeline by stage</h2>
              <p>Current open value</p>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('Deals')}>
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
  if (page === 'Tasks follow-up') return <TaskWorkspace view="follow-up" />;
  if (page === 'Companies') return <CompanyWorkspace readOnly={role === 'viewer'} />;
  if (page === 'Contacts') return <ContactWorkspace readOnly={role === 'viewer'} />;
  if (page === 'Activities' || page === 'Recent activity')
    return <ActivityWorkspace recent={page === 'Recent activity'} />;
  if (page === 'Deals' || page === 'Deals closing soon')
    return <DealWorkspace closingSoon={page === 'Deals closing soon'} />;
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

function ActivityWorkspace({ recent = false }: { recent?: boolean }) {
  const [items, setItems] = useState<
    Array<{ id: string; type: string; subject: string; occurred_at: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void fetch(`/api/activities?pageSize=${recent ? 10 : 25}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load activity records.');
        const value = (await response.json()) as { items: typeof items };
        setItems(value.items);
        setError(null);
        setLoaded(true);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not load activity records.');
        setLoaded(true);
      });
  }, [recent]);
  return (
    <section
      className="data-panel"
      aria-label={recent ? 'Recent activity records' : 'Activity records'}
    >
      <div className="panel-heading">
        <div>
          <h2>{recent ? 'Recent activity' : 'Activity records'}</h2>
          <p>
            {recent ? 'Latest 10 entries in your organization' : 'Organization activity history'}
          </p>
        </div>
      </div>
      {error ? <ErrorState title="Activities unavailable" description={error} /> : null}
      {!error && !loaded ? <LoadingState label="Loading activity records" /> : null}
      {!error && loaded && !items.length ? (
        <EmptyState title="No activity records" description="No activity has been recorded yet." />
      ) : null}
      {items.length ? (
        <ul className="record-list">
          {items.map((activity) => (
            <li key={activity.id}>
              <strong>{activity.subject}</strong> · {activity.type} ·{' '}
              {new Date(activity.occurred_at).toLocaleString()}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DealWorkspace({ closingSoon = false }: { closingSoon?: boolean }) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      name: string;
      company_name: string;
      stage_name: string;
      amount_minor: number;
      currency: string;
      expected_close_date: string;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void fetch(`/api/deals?status=open${closingSoon ? '&closingSoon=true' : ''}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load pipeline records.');
        const value = (await response.json()) as { items: typeof items };
        setItems(value.items);
        setError(null);
        setLoaded(true);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not load pipeline records.');
        setLoaded(true);
      });
  }, [closingSoon]);
  return (
    <section
      className="data-panel"
      aria-label={closingSoon ? 'Deals closing soon' : 'Open pipeline records'}
    >
      <div className="panel-heading">
        <div>
          <h2>{closingSoon ? 'Deals closing soon' : 'Open pipeline'}</h2>
          <p>
            {closingSoon
              ? 'Expected to close in the next 7 days'
              : 'Active deals in your organization'}
          </p>
        </div>
      </div>
      {error ? <ErrorState title="Deals unavailable" description={error} /> : null}
      {!error && !loaded ? <LoadingState label="Loading pipeline records" /> : null}
      {!error && loaded && !items.length ? (
        <EmptyState
          title={closingSoon ? 'No deals closing soon' : 'No open deals'}
          description={
            closingSoon
              ? 'There are no active deals expected to close in the next 7 days.'
              : 'There are no active deals in your organization.'
          }
        />
      ) : null}
      {items.length ? (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Open pipeline deals</caption>
            <thead>
              <tr>
                <th scope="col">Deal</th>
                <th scope="col">Company</th>
                <th scope="col">Stage</th>
                <th scope="col">Amount</th>
                <th scope="col">Close date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((deal) => (
                <tr key={deal.id}>
                  <td>{deal.name}</td>
                  <td>{deal.company_name}</td>
                  <td>{deal.stage_name}</td>
                  <td>
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: deal.currency,
                    }).format(deal.amount_minor / 100)}
                  </td>
                  <td>{deal.expected_close_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ContactWorkspace({ readOnly }: { readOnly: boolean }) {
  const [items, setItems] = useState<
    Array<{ id: string; firstName: string; lastName: string; email: string | null }>
  >([]);
  const [membershipId, setMembershipId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    void fetch('/api/contacts').then(async (response) => {
      const value = (await response.json()) as { items: typeof items; actorMembershipId: string };
      setItems(value.items);
      setMembershipId(value.actorMembershipId);
    });
  useEffect(load, []);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const response = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName,
        lastName,
        email: email || null,
        ownerMembershipId: membershipId,
      }),
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      return setError(value?.error?.message ?? 'Please correct the contact details and try again.');
    }
    setError(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    load();
  }
  return (
    <section className="data-panel" aria-label="Contact records">
      <h2>Contact records</h2>
      <form onSubmit={create}>
        <label>
          First name
          <input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
            disabled={readOnly}
          />
        </label>
        <label>
          Last name
          <input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
            disabled={readOnly}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <button className="primary-button" type="submit" disabled={readOnly || !membershipId}>
          Create contact
        </button>
      </form>
      {error ? <ErrorState title="Could not create contact" description={error} /> : null}
      {readOnly ? <p className="read-only-note">Viewer access · read only</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.firstName} {item.lastName}
            {item.email ? ` · ${item.email}` : ''}
          </li>
        ))}
      </ul>
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
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [size, setSize] = useState('');
  const [address, setAddress] = useState('');
  const [tags, setTags] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    void fetch(`/api/companies?q=${encodeURIComponent(query)}`)
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
  useEffect(load, [query]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        website,
        industry,
        lifecycleStatus,
        phone,
        description,
        externalReference,
        size,
        address,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    });
    if (!response.ok) return setError('Could not create company.');
    setName('');
    setWebsite('');
    setIndustry('');
    setPhone('');
    setDescription('');
    setExternalReference('');
    setSize('');
    setAddress('');
    setTags('');
    setError(null);
    load();
  }
  return (
    <section className="data-panel" aria-label="Company records">
      <h2>Company records</h2>
      <label>
        Search companies
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
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
          Phone
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          External reference
          <input
            value={externalReference}
            onChange={(event) => setExternalReference(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Size
          <input
            value={size}
            onChange={(event) => setSize(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Address
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Tags
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
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

type TaskView =
  | 'all'
  | 'assigned'
  | 'overdue'
  | 'due-today'
  | 'upcoming'
  | 'completed'
  | 'archived'
  | 'follow-up';

function TaskWorkspace({ view = 'all' }: { view?: 'all' | 'follow-up' }) {
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
    archivedAt: string | null;
    version: number;
  };
  const [items, setItems] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [contactId, setContactId] = useState('');
  const [dealId, setDealId] = useState('');
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [contacts, setContacts] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [deals, setDeals] = useState<Array<{ id: string; name: string }>>([]);
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [selectedView, setSelectedView] = useState<TaskView>(view);
  const [assigneeMembershipId, setAssigneeMembershipId] = useState<string | null>(null);
  const [assignableMembers, setAssignableMembers] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const apiUrl = (path: string) => new URL(path, window.location.origin).toString();

  async function loadTasks() {
    setLoading(true);
    try {
      const response = await fetch(
        apiUrl(`/api/tasks${selectedView === 'all' ? '' : `?view=${selectedView}`}`),
      );
      if (!response.ok) throw new Error('Could not load tasks.');
      const data = (await response.json()) as {
        items: Task[];
        actorMembershipId: string;
        assignableMembers: Array<{ id: string; displayName: string }>;
      };
      setItems(data.items);
      setAssigneeMembershipId((current) => current ?? data.actorMembershipId);
      setAssignableMembers(data.assignableMembers ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
  }, [selectedView]);

  useEffect(() => {
    void fetch('/api/companies?q=')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load companies.');
        return (await response.json()) as { items: Array<{ id: string; name: string }> };
      })
      .then((data) => setCompanies(data.items))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    void fetch('/api/deals?status=open')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load deals.');
        return (await response.json()) as { items: Array<{ id: string; name: string }> };
      })
      .then((data) => setDeals(data.items))
      .catch(() => setDeals([]));
  }, []);

  useEffect(() => {
    void fetch('/api/contacts')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load contacts.');
        return (await response.json()) as {
          items: Array<{ id: string; firstName: string; lastName: string }>;
        };
      })
      .then((data) => setContacts(data.items))
      .catch(() => setContacts([]));
  }, []);

  async function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !assigneeMembershipId) return;
    try {
      const response = await fetch(apiUrl('/api/tasks'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          assigneeMembershipId,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          priority,
          companyId: companyId || null,
          contactId: contactId || null,
          dealId: dealId || null,
        }),
      });
      if (!response.ok) throw new Error('Could not create task.');
      const created = (await response.json()) as Task;
      setItems((current) => [...current, created]);
      setTitle('');
      setDueAt('');
      setCompanyId('');
      setContactId('');
      setDealId('');
      setPriority('medium');
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
  async function archiveTask(task: Task) {
    const response = await fetch(apiUrl(`/api/tasks/${task.id}/archive`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: task.version }),
    });
    if (!response.ok) return setError('Could not archive task.');
    setItems((current) => current.filter((item) => item.id !== task.id));
  }
  async function restoreTask(task: Task) {
    const response = await fetch(apiUrl(`/api/tasks/${task.id}/restore`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: task.version }),
    });
    if (!response.ok) return setError('Could not restore task.');
    setItems((current) => current.filter((item) => item.id !== task.id));
  }
  return (
    <section className="data-panel">
      <div className="panel-heading">
        <div>
          <h2>{view === 'follow-up' ? 'Follow-up work' : 'Task workspace'}</h2>
          <p>
            {view === 'follow-up'
              ? 'Overdue tasks and tasks due in the next seven days, in UTC.'
              : 'Due-state views use UTC.'}
          </p>
        </div>
      </div>
      <form className="task-form" onSubmit={addTask}>
        <label>
          Task view
          <select
            value={selectedView}
            onChange={(event) => setSelectedView(event.target.value as TaskView)}
            disabled={view === 'follow-up'}
          >
            <option value="all">All active and completed</option>
            <option value="assigned">Assigned to me</option>
            <option value="overdue">Overdue</option>
            <option value="due-today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
            {view === 'follow-up' ? <option value="follow-up">Follow-up work</option> : null}
          </select>
        </label>
        <label>
          Task title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Assignee
          <select
            value={assigneeMembershipId ?? ''}
            onChange={(event) => setAssigneeMembershipId(event.target.value)}
            required
          >
            {assignableMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Related company
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">No related company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Related contact
          <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">No related contact</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Related deal
          <select value={dealId} onChange={(event) => setDealId(event.target.value)}>
            <option value="">No related deal</option>
            {deals.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date and time
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Task['priority'])}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
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
            {selectedView === 'archived' ? (
              <button type="button" className="text-button" onClick={() => void restoreTask(item)}>
                Restore
              </button>
            ) : (
              <button type="button" className="text-button" onClick={() => void archiveTask(item)}>
                Archive
              </button>
            )}
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

function TaskTable({ tasks }: { tasks: DashboardData['followUpTasks'] }) {
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
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <a href={`#${task.id}`}>{task.title}</a>
              </td>
              <td>{task.companyName}</td>
              <td className={task.priority === 'urgent' ? 'warning-text' : undefined}>
                {new Date(task.dueAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td>{task.assigneeName}</td>
            </tr>
          ))}
          {!tasks.length ? (
            <tr>
              <td colSpan={4}>No upcoming follow-up work.</td>
            </tr>
          ) : null}
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
