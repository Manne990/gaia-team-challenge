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
type Role = 'owner' | 'member' | 'viewer';

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

const companies = [
  ['Acme Nordic AB', 'Technology', 'Customer', 'Lina Berg', 'Today'],
  ['Northstar Logistics', 'Transport', 'Qualified', 'Omar Khan', 'Yesterday'],
  ['Acme Nordic AB', 'Technology', 'Prospect', 'Lina Berg', 'Aug 4'],
  ['Stjärna Retail', 'Retail', 'Customer', 'Mikael Chen', 'Aug 2'],
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

function Dashboard() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Monday, August 9</p>
          <h1>Good morning, Lina</h1>
          <p className="subtle">Here’s what needs your attention across Northstar Demo.</p>
        </div>
        <button className="primary">+ Log activity</button>
      </div>
      <section className="metrics" aria-label="Dashboard metrics">
        <Metric label="Pipeline value" value="kr 4.82m" detail="12% from last month" />
        <Metric label="Deals closing soon" value="8" detail="kr 1.14m by Aug 31" />
        <Metric label="Overdue tasks" value="3" detail="Needs attention today" alert />
        <Metric label="New contacts" value="24" detail="This month" />
      </section>
      <section className="content-grid">
        <article className="panel">
          <PanelTitle title="Pipeline by stage" action="View deals" />
          <div className="stage-list">
            {[
              ['Qualified', 'kr 1.32m', 72],
              ['Proposal', 'kr 1.08m', 58],
              ['Negotiation', 'kr 940k', 49],
              ['Won', 'kr 1.47m', 80],
            ].map(([name, amount, width]) => (
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
              title="Send revised proposal to Acme Nordic"
              due="Overdue · Fri"
            />
            <Task urgency="today" title="Prepare discovery notes" due="Due today · 14:00" />
            <Task urgency="upcoming" title="Follow up with Stjärna Retail" due="Tomorrow · 09:30" />
          </ul>
        </article>
      </section>
      <section className="panel">
        <PanelTitle title="Recent activity" action="View activity" />
        <div className="activity">
          <span className="avatar">LB</span>
          <p>
            <strong>Lina Berg</strong> logged a call with <a href="#company">Acme Nordic AB</a>
            <small>12 minutes ago · Call</small>
          </p>
        </div>
        <div className="activity">
          <span className="avatar dark">OK</span>
          <p>
            <strong>Omar Khan</strong> moved Northstar Logistics to Proposal
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

function ListPage({ page }: { page: Page }) {
  const singular = page === 'Companies' ? 'company' : page.slice(0, -1).toLowerCase();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{page === 'Companies' ? 'Accounts' : 'Workspace'}</p>
          <h1>{page}</h1>
          <p className="subtle">Manage your organization’s {page.toLowerCase()}.</p>
        </div>
        <button className="primary">+ Add {singular}</button>
      </div>
      <section className="panel table-panel">
        <div className="toolbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={`Search ${page.toLowerCase()}`}
              placeholder={`Search ${page.toLowerCase()}`}
            />
          </label>
          <button className="secondary">
            Filter <span aria-hidden="true">⌄</span>
          </button>
          <button className="secondary">
            Sort <span aria-hidden="true">⌄</span>
          </button>
          <button className="text-button">Clear all</button>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{page} list</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Industry</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Last activity</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company, index) => (
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
              ))}
            </tbody>
          </table>
        </div>
        <footer className="pagination">
          <span>Showing 1–4 of 126</span>
          <div>
            <button className="secondary" disabled>
              Previous
            </button>
            <button className="secondary">Next</button>
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

export function App({ role = 'owner' }: { role?: Role }) {
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
      <Dashboard />
    ) : page === 'Companies' || page === 'Contacts' ? (
      <ListPage page={page} />
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
            <strong>Northstar Demo</strong>
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
              <strong>Lina Berg</strong>
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
                Signed in as <strong>Lina Berg</strong>.
              </>
            )}
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={closeDialog}>
              {confirmingSignOut ? 'Keep working' : 'Cancel'}
            </button>
            <button
              className="danger"
              onClick={() => {
                if (!confirmingSignOut) {
                  setConfirmingSignOut(true);
                  return;
                }
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
