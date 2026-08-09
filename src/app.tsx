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
  role,
}: {
  page: Page;
  workspace: Workspace;
  user: ShellUser;
  role: Role;
}) {
  const canEdit = role !== 'viewer';
  type Contact = {
    id: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    companyId?: string | null;
    companyName?: string | null;
    ownerId?: string | null;
    status: string;
    tagsJson?: string;
    communicationPreference?: 'email' | 'phone' | 'none';
    updatedAt: string;
    archivedAt?: string | null;
    version: number;
    activities?: Array<{
      id: string;
      subject: string;
      type: string;
      occurredAt: string;
      creatorName: string;
    }>;
    deals?: Array<{ id: string; name: string; status: string }>;
    tasks?: Array<{ id: string; title: string; status: string }>;
    history?: Array<{ id: string; action: string; createdAt: string }>;
  };
  const [contactRows, setContactRows] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactSort, setContactSort] = useState('name');
  const [contactStatus, setContactStatus] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactOwner, setContactOwner] = useState('');
  const [contactTag, setContactTag] = useState('');
  const [showContactFilters, setShowContactFilters] = useState(false);
  const [showArchivedContacts, setShowArchivedContacts] = useState(false);
  const [contactPage, setContactPage] = useState(1);
  const [contactTotal, setContactTotal] = useState(0);
  const [showContactForm, setShowContactForm] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactNotice, setContactNotice] = useState('');
  const [contactRefresh, setContactRefresh] = useState(0);
  const contactRequest = useRef(0);
  const refreshContacts = () => setContactRefresh((value) => value + 1);
  useEffect(() => {
    if (page === 'Contacts') {
      const requestNumber = contactRequest.current + 1;
      contactRequest.current = requestNumber;
      const query = new URLSearchParams({
        query: contactSearch,
        sort: contactSort,
        status: contactStatus,
        companyId: contactCompany,
        ownerId: contactOwner,
        tag: contactTag,
        page: String(contactPage),
      });
      if (showArchivedContacts) query.set('archived', 'true');
      fetch(`/api/contacts?${query}`)
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((data) => {
          if (contactRequest.current !== requestNumber) return;
          setContactTotal(data.total || 0);
          setContactRows(data.items || []);
        });
    }
  }, [
    page,
    contactSearch,
    contactSort,
    contactStatus,
    contactCompany,
    contactOwner,
    contactTag,
    contactPage,
    showArchivedContacts,
    contactRefresh,
  ]);
  const singular = page === 'Companies' ? 'company' : page.slice(0, -1).toLowerCase();
  const companies =
    page === 'Contacts'
      ? contactRows.map((contact) => [
          `${contact.firstName} ${contact.lastName}`,
          contact.companyId || 'Independent',
          contact.status,
          contact.ownerId || 'Unassigned',
          new Date(contact.updatedAt).toLocaleDateString(),
        ])
      : companiesFor(workspace, user);
  const contactAt = (index: number) => contactRows[index];
  const clearContactFilters = () => {
    setContactSearch('');
    setContactSort('name');
    setContactStatus('');
    setContactCompany('');
    setContactOwner('');
    setContactTag('');
    setShowArchivedContacts(false);
    setContactPage(1);
  };
  const contactPayload = (fields: FormData) => ({
    firstName: String(fields.get('firstName') || ''),
    lastName: String(fields.get('lastName') || ''),
    email: String(fields.get('email') || ''),
    phone: String(fields.get('phone') || ''),
    jobTitle: String(fields.get('jobTitle') || ''),
    companyId: String(fields.get('companyId') || '') || null,
    ownerId: String(fields.get('ownerId') || '') || null,
    status: String(fields.get('status') || 'active'),
    tags: String(fields.get('tags') || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    communicationPreference: String(fields.get('communicationPreference') || 'email'),
  });
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
        {(page !== 'Contacts' || canEdit) && (
          <button
            className="primary"
            onClick={page === 'Contacts' ? () => setShowContactForm(true) : undefined}
          >
            + Add {singular}
          </button>
        )}
      </div>
      {page === 'Contacts' && canEdit && showContactForm && (
        <form
          className="panel"
          onSubmit={async (event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const response = await fetch('/api/contacts', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(contactPayload(fields)),
            });
            if (response.ok) {
              const created = await response.json();
              setContactRows((rows) => [created, ...rows.filter((row) => row.id !== created.id)]);
              setContactTotal((total) => total + 1);
              setShowContactForm(false);
              setContactPage(1);
              setContactNotice(
                created.duplicateWarning
                  ? `Possible duplicate: ${created.duplicateWarning.firstName} ${created.duplicateWarning.lastName} already uses this email. No records were merged.`
                  : '',
              );
              refreshContacts();
            }
          }}
        >
          <h2>New contact</h2>
          <label>
            First name
            <input name="firstName" required />
          </label>
          <label>
            Last name
            <input name="lastName" required />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Job title
            <input name="jobTitle" />
          </label>
          <label>
            Company ID (optional)
            <input name="companyId" />
          </label>
          <label>
            Owner ID (optional)
            <input name="ownerId" />
          </label>
          <label>
            Status
            <select name="status">
              <option value="active">Active</option>
              <option value="lead">Lead</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Tags (comma separated)
            <input name="tags" />
          </label>
          <label>
            Preferred contact method
            <select name="communicationPreference">
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="none">None</option>
            </select>
          </label>
          <button className="primary">Save contact</button>
          <button type="button" className="secondary" onClick={() => setShowContactForm(false)}>
            Cancel
          </button>
        </form>
      )}
      {page === 'Contacts' && contactNotice && (
        <p className="panel" role="status">
          {contactNotice}
        </p>
      )}
      <section className="panel table-panel">
        <div className="toolbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={`Search ${page.toLowerCase()}`}
              placeholder={`Search ${page.toLowerCase()}`}
              value={page === 'Contacts' ? contactSearch : undefined}
              onChange={
                page === 'Contacts'
                  ? (event) => {
                      setContactSearch(event.target.value);
                      setContactPage(1);
                    }
                  : undefined
              }
            />
          </label>
          <button
            className="secondary"
            onClick={
              page === 'Contacts' ? () => setShowContactFilters((visible) => !visible) : undefined
            }
          >
            Filter <span aria-hidden="true">⌄</span>
          </button>
          <button
            className="secondary"
            onClick={
              page === 'Contacts'
                ? () => {
                    setContactSort(contactSort === 'name' ? 'createdAt' : 'name');
                    setContactPage(1);
                  }
                : undefined
            }
          >
            Sort <span aria-hidden="true">⌄</span>
          </button>
          <button
            className="text-button"
            onClick={page === 'Contacts' ? clearContactFilters : undefined}
          >
            Clear all
          </button>
        </div>
        {page === 'Contacts' && showContactFilters && (
          <div className="toolbar" aria-label="Contact filters">
            <label>
              Status
              <select
                value={contactStatus}
                onChange={(event) => {
                  setContactStatus(event.target.value);
                  setContactPage(1);
                }}
              >
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="lead">Lead</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label>
              Company ID
              <input
                value={contactCompany}
                onChange={(event) => {
                  setContactCompany(event.target.value);
                  setContactPage(1);
                }}
              />
            </label>
            <label>
              Owner ID
              <input
                value={contactOwner}
                onChange={(event) => {
                  setContactOwner(event.target.value);
                  setContactPage(1);
                }}
              />
            </label>
            <label>
              Tag
              <input
                value={contactTag}
                onChange={(event) => {
                  setContactTag(event.target.value);
                  setContactPage(1);
                }}
              />
            </label>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setShowArchivedContacts((archived) => !archived);
                setContactPage(1);
              }}
            >
              {showArchivedContacts ? 'Show active' : 'Show archived'}
            </button>
          </div>
        )}
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
                      <a
                        href={page === 'Contacts' ? `#contact-${contactAt(index)?.id}` : '#company'}
                        onClick={
                          page === 'Contacts'
                            ? async (event) => {
                                event.preventDefault();
                                const response = await fetch(
                                  `/api/contacts/${contactAt(index)?.id}`,
                                );
                                if (response.ok) setSelectedContact(await response.json());
                              }
                            : undefined
                        }
                      >
                        {company[0]}
                      </a>
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
                      {canEdit && (
                        <IconButton
                          label={`${showArchivedContacts ? 'Restore' : 'Archive'} ${company[0]}`}
                          onClick={
                            page === 'Contacts'
                              ? async () => {
                                  await fetch(
                                    `/api/contacts/${contactAt(index)?.id}/${showArchivedContacts ? 'restore' : 'archive'}`,
                                    {
                                      method: 'POST',
                                    },
                                  );
                                  refreshContacts();
                                }
                              : undefined
                          }
                        >
                          ⋯
                        </IconButton>
                      )}
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
      {selectedContact && (
        <Dialog
          title={`${selectedContact.firstName} ${selectedContact.lastName}`}
          onClose={() => setSelectedContact(null)}
        >
          {canEdit && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const response = await fetch(`/api/contacts/${selectedContact.id}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    ...contactPayload(new FormData(event.currentTarget)),
                    version: selectedContact.version,
                  }),
                });
                if (response.ok) {
                  const saved = await response.json();
                  setContactNotice(
                    saved.duplicateWarning
                      ? `Possible duplicate: ${saved.duplicateWarning.firstName} ${saved.duplicateWarning.lastName} already uses this email. No records were merged.`
                      : '',
                  );
                  const detail = await fetch(`/api/contacts/${selectedContact.id}`);
                  if (detail.ok) setSelectedContact(await detail.json());
                  refreshContacts();
                }
              }}
            >
              <p className="subtle">
                {selectedContact.companyName || selectedContact.companyId || 'Independent contact'}{' '}
                · {selectedContact.ownerId || 'Unassigned owner'}
              </p>
              <label>
                First name
                <input name="firstName" required defaultValue={selectedContact.firstName} />
              </label>
              <label>
                Last name
                <input name="lastName" required defaultValue={selectedContact.lastName} />
              </label>
              <label>
                Email
                <input name="email" type="email" defaultValue={selectedContact.email || ''} />
              </label>
              <label>
                Phone
                <input name="phone" defaultValue={selectedContact.phone || ''} />
              </label>
              <label>
                Job title
                <input name="jobTitle" defaultValue={selectedContact.jobTitle || ''} />
              </label>
              <label>
                Company ID
                <input name="companyId" defaultValue={selectedContact.companyId || ''} />
              </label>
              <label>
                Owner ID
                <input name="ownerId" defaultValue={selectedContact.ownerId || ''} />
              </label>
              <label>
                Status
                <select name="status" defaultValue={selectedContact.status}>
                  <option value="active">Active</option>
                  <option value="lead">Lead</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label>
                Tags (comma separated)
                <input
                  name="tags"
                  defaultValue={JSON.parse(selectedContact.tagsJson || '[]').join(', ')}
                />
              </label>
              <label>
                Preferred contact method
                <select
                  name="communicationPreference"
                  defaultValue={selectedContact.communicationPreference || 'email'}
                >
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="none">None</option>
                </select>
              </label>
              <button className="primary">Save changes</button>
            </form>
          )}
          <section className="panel">
            <h3>Related work</h3>
            <p>
              {selectedContact.activities?.length || 0} activities ·{' '}
              {selectedContact.deals?.length || 0} deals · {selectedContact.tasks?.length || 0}{' '}
              tasks
            </p>
            <h3>Activity timeline</h3>
            <ul aria-label="Contact activity timeline">
              {(selectedContact.activities || []).map((activity) => (
                <li key={activity.id}>
                  {activity.subject} · {activity.type} · {activity.creatorName} ·{' '}
                  {new Date(activity.occurredAt).toLocaleString()}
                </li>
              ))}
              {!selectedContact.activities?.length && (
                <li>No activity recorded for this contact.</li>
              )}
            </ul>
            <h3>Change history</h3>
            <ul>
              {(selectedContact.history || []).map((entry) => (
                <li key={entry.id}>
                  {entry.action} · {new Date(entry.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
            {canEdit && (
              <button
                className="secondary"
                onClick={async () => {
                  await fetch(
                    `/api/contacts/${selectedContact.id}/${selectedContact.archivedAt ? 'restore' : 'archive'}`,
                    { method: 'POST' },
                  );
                  setSelectedContact(null);
                  refreshContacts();
                }}
              >
                {selectedContact.archivedAt ? 'Restore contact' : 'Archive contact'}
              </button>
            )}
          </section>
        </Dialog>
      )}
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
  activitiesContent,
  dealsContent,
  importsContent,
  tasksContent,
  onSignOut,
}: {
  role: Role;
  user: ShellUser;
  workspace: Workspace;
  companiesContent?: ReactNode;
  activitiesContent?: ReactNode;
  dealsContent?: ReactNode;
  importsContent?: ReactNode;
  tasksContent?: ReactNode;
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
    ) : page === 'Activities' && activitiesContent ? (
      activitiesContent
    ) : page === 'Imports' && importsContent ? (
      importsContent
    ) : page === 'Deals' && dealsContent ? (
      dealsContent
    ) : page === 'Tasks' && tasksContent ? (
      tasksContent
    ) : page === 'Companies' || page === 'Contacts' ? (
      <ListPage page={page} workspace={workspace} user={user} role={role} />
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
          <button
            className="profile"
            aria-label={`${user.displayName} ${role} — Open account menu`}
            onClick={(event) => openDialog(event.currentTarget)}
          >
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
