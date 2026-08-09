import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type Page =
  | 'Dashboard'
  | 'Companies'
  | 'Contacts'
  | 'Activities'
  | 'Deals'
  | 'Tasks'
  | 'Imports'
  | 'Audit'
  | 'Administration';
export type Role = 'owner' | 'member' | 'viewer';
export type ShellUser = { displayName: string };
export type Workspace = { id: string; name: string };

const navigation: Array<{ page: Page; icon: string; ownerOnly?: boolean }> = [
  { page: 'Dashboard', icon: '⌂' },
  { page: 'Companies', icon: '▦' },
  { page: 'Contacts', icon: '♙' },
  { page: 'Activities', icon: '◷' },
  { page: 'Deals', icon: '◇' },
  { page: 'Tasks', icon: '✓' },
  { page: 'Imports', icon: '↑' },
  { page: 'Audit', icon: '▤' },
  { page: 'Administration', icon: '⚙', ownerOnly: true },
];

const companiesFor = (workspace: Workspace, user: ShellUser) =>
  workspace.id === 'org_northstar'
    ? [
        ['Acme Nordic AB', 'Technology', 'Customer', 'Lina Berg', 'Today'],
        ['Northstar Logistics', 'Transport', 'Qualified', 'Omar Khan', 'Yesterday'],
        ['Acme Nordic AB', 'Technology', 'Prospect', 'Lina Berg', 'Aug 4'],
        ['Stjärna Retail', 'Retail', 'Customer', 'Mikael Chen', 'Aug 2'],
      ]
    : [
        [`${workspace.name} account`, 'Operations', 'Active', user.displayName, 'Today'],
        ['Prospect review', 'Services', 'Qualified', user.displayName, 'Yesterday'],
      ];

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Status({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose();
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', close);
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            ×
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

function Dashboard({ user, workspace }: { user: ShellUser; workspace: Workspace }) {
  const firstName = user.displayName.split(' ')[0] || user.displayName;
  const isNorthstar = workspace.id === 'org_northstar';
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Monday, August 9</p>
          <h1>Good morning, {firstName}</h1>
          <p className="subtle">Here’s what needs your attention across {workspace.name}.</p>
        </div>
        <button className="primary">+ Log activity</button>
      </div>
      <section className="metrics" aria-label="Dashboard metrics">
        <Metric
          label="Pipeline value"
          value={isNorthstar ? 'kr 4.82m' : '—'}
          detail="Current workspace"
        />
        <Metric
          label="Deals closing soon"
          value={isNorthstar ? '8' : '—'}
          detail="Current workspace"
        />
        <Metric
          label="Overdue tasks"
          value={isNorthstar ? '3' : '0'}
          detail="Needs attention today"
          alert
        />
        <Metric label="New contacts" value={isNorthstar ? '24' : '—'} detail="This month" />
      </section>
      <section className="content-grid">
        <article className="panel">
          <PanelTitle title="Pipeline by stage" action="View deals" />
          <div className="stage-list">
            {(isNorthstar
              ? [
                  ['Qualified', 'kr 1.32m', 72],
                  ['Proposal', 'kr 1.08m', 58],
                  ['Negotiation', 'kr 940k', 49],
                  ['Won', 'kr 1.47m', 80],
                ]
              : [['No pipeline data', '—', 0]]
            ).map(([name, amount, width]) => (
              <div className="stage" key={String(name)}>
                <div>
                  <span>{name}</span>
                  <strong>{amount}</strong>
                </div>
                <div className="bar">
                  <i style={{ width: `${width}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <PanelTitle title="My work" action="View all" />
          <ul className="task-list">
            <Task
              urgency="overdue"
              title={
                isNorthstar ? 'Send revised proposal to Acme Nordic' : 'Review workspace activity'
              }
              due="Overdue · Fri"
            />
            <Task urgency="today" title="Prepare discovery notes" due="Due today · 14:00" />
            <Task
              urgency="upcoming"
              title={isNorthstar ? 'Follow up with Stjärna Retail' : 'Plan next steps'}
              due="Tomorrow · 09:30"
            />
          </ul>
        </article>
      </section>
      <section className="panel">
        <PanelTitle title="Recent activity" action="View activity" />
        <div className="activity">
          <span className="avatar">LB</span>
          <p>
            <strong>{isNorthstar ? 'Lina Berg' : user.displayName}</strong> logged a call with{' '}
            <a href="#company">{isNorthstar ? 'Acme Nordic AB' : `${workspace.name} account`}</a>
            <small>12 minutes ago · Call</small>
          </p>
        </div>
        <div className="activity">
          <span className="avatar dark">OK</span>
          <p>
            <strong>{isNorthstar ? 'Omar Khan' : user.displayName}</strong> moved{' '}
            {isNorthstar ? 'Northstar Logistics' : 'a workspace record'} to Proposal
            <small>1 hour ago · Deal change</small>
          </p>
        </div>
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  detail,
  alert,
}: {
  label: string;
  value: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <article className="metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small className={alert ? 'alert' : ''}>{detail}</small>
    </article>
  );
}
function PanelTitle({ title, action }: { title: string; action: string }) {
  return (
    <header className="panel-title">
      <h2>{title}</h2>
      <button className="link-button">
        {action} <span aria-hidden="true">→</span>
      </button>
    </header>
  );
}
function Task({ title, due, urgency }: { title: string; due: string; urgency: string }) {
  return (
    <li>
      <button className="check" aria-label={`Mark ${title} complete`} />
      <div>
        <strong>{title}</strong>
        <small className={urgency}>{due}</small>
      </div>
    </li>
  );
}

function ListPage({
  page,
  workspace,
  user,
}: {
  page: Page;
  workspace: Workspace;
  user: ShellUser;
}) {
  const [contactRows, setContactRows] = useState<Array<string[]>>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactSort, setContactSort] = useState('name');
  const [contactStatus, setContactStatus] = useState('');
  const [contactPage, setContactPage] = useState(1);
  const [contactTotal, setContactTotal] = useState(0);
  useEffect(() => {
    if (page === 'Contacts')
      fetch(
        `/api/contacts?query=${encodeURIComponent(contactSearch)}&sort=${contactSort}&status=${contactStatus}&page=${contactPage}`,
      )
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((data) => {
          setContactTotal(data.total || 0);
          setContactRows(
            data.items.map((c: any) => [
              `${c.firstName} ${c.lastName}`,
              c.companyId || 'Independent',
              c.status,
              c.ownerId || 'Unassigned',
              new Date(c.updatedAt).toLocaleDateString(),
            ]),
          );
        });
  }, [page, contactSearch, contactSort, contactStatus, contactPage]);
  const singular = page === 'Companies' ? 'company' : page.slice(0, -1).toLowerCase();
  const companies = page === 'Contacts' ? contactRows : companiesFor(workspace, user);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{page === 'Companies' ? 'Accounts' : 'Workspace'}</p>
          <h1>{page}</h1>
          <p className="subtle">
            Manage {workspace.name}’s {page.toLowerCase()}.
          </p>
        </div>
        <button
          className="primary"
          onClick={
            page === 'Contacts'
              ? async () => {
                  const value = window.prompt('Contact name');
                  const parts = value?.trim().split(/\s+/) || [];
                  if (parts.length < 2) return;
                  await fetch('/api/contacts', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      firstName: parts[0],
                      lastName: parts.slice(1).join(' '),
                    }),
                  });
                  setContactSearch('');
                }
              : undefined
          }
        >
          + Add {singular}
        </button>
      </div>
      <section className="panel table-panel">
        <div className="toolbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={`Search ${page.toLowerCase()}`}
              placeholder={`Search ${page.toLowerCase()}`}
              value={page === 'Contacts' ? contactSearch : undefined}
              onChange={
                page === 'Contacts' ? (event) => setContactSearch(event.target.value) : undefined
              }
            />
          </label>
          <button
            className="secondary"
            onClick={
              page === 'Contacts'
                ? () => setContactStatus(contactStatus ? '' : 'active')
                : undefined
            }
          >
            Filter <span aria-hidden="true">⌄</span>
          </button>
          <button
            className="secondary"
            onClick={
              page === 'Contacts'
                ? () => setContactSort(contactSort === 'name' ? 'createdAt' : 'name')
                : undefined
            }
          >
            Sort <span aria-hidden="true">⌄</span>
          </button>
          <button
            className="text-button"
            onClick={
              page === 'Contacts'
                ? () => {
                    setContactSearch('');
                    setContactSort('name');
                    setContactPage(1);
                  }
                : undefined
            }
          >
            Clear all
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{page} list</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>{page === 'Contacts' ? 'Company' : 'Industry'}</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Last activity</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 ? (
                <tr>
                  <td colSpan={6}>No {page.toLowerCase()} match the current filters.</td>
                </tr>
              ) : (
                companies.map((company, index) => (
                  <tr key={`${company[0]}-${index}`}>
                    <td>
                      <a href="#company">{company[0]}</a>
                    </td>
                    <td>{company[1]}</td>
                    <td>
                      <Status tone={company[2] === 'Customer' ? 'good' : 'neutral'}>
                        {company[2]}
                      </Status>
                    </td>
                    <td>{company[3]}</td>
                    <td>{company[4]}</td>
                    <td>
                      <IconButton label={`Actions for ${company[0]}`}>⋯</IconButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="pagination">
          <span>
            {page === 'Contacts'
              ? `Showing ${contactRows.length ? (contactPage - 1) * 25 + 1 : 0}–${(contactPage - 1) * 25 + contactRows.length} of ${contactTotal}`
              : 'Showing 1–4 of 126'}
          </span>
          <div>
            <button
              className="secondary"
              disabled={page === 'Contacts' ? contactPage === 1 : true}
              onClick={
                page === 'Contacts' ? () => setContactPage(Math.max(1, contactPage - 1)) : undefined
              }
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={page === 'Contacts' && contactPage * 25 >= contactTotal}
              onClick={page === 'Contacts' ? () => setContactPage(contactPage + 1) : undefined}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </>
  );
}

type OperationalState = 'empty' | 'loading' | 'error' | 'not-found' | 'conflict' | 'forbidden';

const stateCopy: Record<
  OperationalState,
  { icon: string; title: string; body: string; action: string }
> = {
  empty: {
    icon: '◌',
    title: 'Ready for your data',
    body: 'This operational view will show records and filters as soon as they are available.',
    action: 'Create first record',
  },
  loading: {
    icon: '◌',
    title: 'Loading activity',
    body: 'We are retrieving the latest organization activity.',
    action: 'Refresh',
  },
  error: {
    icon: '!',
    title: 'Couldn’t load deals',
    body: 'Your data is safe. Check your connection and try again.',
    action: 'Try again',
  },
  'not-found': {
    icon: '⌕',
    title: 'No audit event found',
    body: 'It may have been removed from the current filter or you may not have access.',
    action: 'Clear filters',
  },
  conflict: {
    icon: '↺',
    title: 'This task changed elsewhere',
    body: 'Review the latest version before saving so nobody’s updates are lost.',
    action: 'Review latest',
  },
  forbidden: {
    icon: '⊘',
    title: 'Owner access required',
    body: 'Only organization owners can manage members and settings.',
    action: 'Return to dashboard',
  },
};

function OperationalStatePanel({ state, page }: { state: OperationalState; page: Page }) {
  const copy = stateCopy[state];
  return (
    <section
      className={`state-panel state-${state}`}
      aria-live={state === 'loading' ? 'polite' : undefined}
    >
      <span className="state-icon" aria-hidden="true">
        {copy.icon}
      </span>
      <h2>{state === 'empty' ? `${page} ${copy.title.toLowerCase()}` : copy.title}</h2>
      <p>{copy.body}</p>
      <button className={state === 'error' ? 'secondary' : 'primary'}>{copy.action}</button>
    </section>
  );
}

function Placeholder({ page, role }: { page: Page; role: Role }) {
  const state: OperationalState =
    page === 'Administration' && role !== 'owner'
      ? 'forbidden'
      : page === 'Activities'
        ? 'loading'
        : page === 'Deals'
          ? 'error'
          : page === 'Tasks'
            ? 'conflict'
            : page === 'Audit'
              ? 'not-found'
              : 'empty';
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{page}</h1>
        </div>
      </div>
      <OperationalStatePanel state={state} page={page} />
    </>
  );
}

export function App({
  role,
  user,
  workspace,
  companiesContent,
  onSignOut,
}: {
  role: Role;
  user: ShellUser;
  workspace: Workspace;
  companiesContent?: ReactNode;
  onSignOut?: () => Promise<void>;
}) {
  const [page, setPage] = useState<Page>('Dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [notice, setNotice] = useState('Updates are saved automatically.');
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const navigate = (next: Page) => {
    setPage(next);
    setMobileOpen(false);
  };
  const openDialog = (trigger: HTMLButtonElement) => {
    dialogTriggerRef.current = trigger;
    setConfirmingSignOut(false);
    setDialog(true);
  };
  const closeDialog = () => {
    setDialog(false);
    requestAnimationFrame(() => dialogTriggerRef.current?.focus());
  };
  const visible = navigation.filter((item) => !item.ownerOnly || role === 'owner');
  const content =
    page === 'Dashboard' ? (
      <Dashboard user={user} workspace={workspace} />
    ) : page === 'Companies' && companiesContent ? (
      companiesContent
    ) : page === 'Companies' || page === 'Contacts' ? (
      <ListPage page={page} workspace={workspace} user={user} />
    ) : (
      <Placeholder page={page} role={role} />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={mobileOpen ? 'sidebar open' : 'sidebar'} aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>Northstar</span>
          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="org-switch">
          <span className="org-avatar">N</span>
          <span>
            <strong>{workspace.name}</strong>
            <small>Sales workspace</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </div>
        <nav>
          {visible.map((item) => (
            <button
              key={item.page}
              className={page === item.page ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(item.page)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.page}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="profile" onClick={(event) => openDialog(event.currentTarget)}>
            <span className="avatar">LB</span>
            <span>
              <strong>{user.displayName}</strong>
              <small>{role}</small>
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <button
            className="menu-button"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <label className="global-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search CRM" placeholder="Search companies, contacts, deals…" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <IconButton label="Help">?</IconButton>
            <IconButton label="Notifications">♧</IconButton>
            <button
              className="mobile-avatar"
              aria-label="Open account menu"
              onClick={(event) => openDialog(event.currentTarget)}
            >
              LB
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {content}
        </main>
      </div>
      {mobileOpen && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {dialog && (
        <Dialog title="Account menu" onClose={closeDialog}>
          <p>
            {confirmingSignOut ? (
              'Signing out ends this session on this device. Unsaved changes will be lost.'
            ) : (
              <>
                Signed in as <strong>{user.displayName}</strong>.
              </>
            )}
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={closeDialog}>
              {confirmingSignOut ? 'Keep working' : 'Cancel'}
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (!confirmingSignOut) {
                  setConfirmingSignOut(true);
                  return;
                }
                await onSignOut?.();
                closeDialog();
                setNotice('You have been signed out.');
              }}
            >
              {confirmingSignOut ? 'Confirm sign out' : 'Sign out'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
