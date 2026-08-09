import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as ShellApp, type Role, type Workspace } from '../app';
import './styles.css';
import '../styles.css';

type Screen = 'loading' | 'ready' | 'unavailable' | 'unexpected';
type Session = {
  user: { displayName: string; email: string };
  role: Role;
  organization: Workspace;
};
type Company = {
  id: string;
  name: string;
  external_reference: string | null;
  lifecycle_status: string;
  industry: string | null;
  size: string | null;
  tags_json: string;
  archived_at: string | null;
  owner_id: string | null;
};
type CompanyDetail = Company & {
  version: number;
  description: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  contacts: { id: string; first_name: string; last_name: string }[];
  activities: {
    id: string;
    subject: string;
    type: string;
    occurredAt: string;
    creatorName: string;
    companyLabel: string | null;
    contactLabel: string | null;
    dealLabel: string | null;
  }[];
  deals: { id: string; name: string }[];
  tasks: { id: string; title: string }[];
  history: { id: string; action: string; created_at: string; summary_json: string }[];
};

function Companies({ canWrite }: { canWrite: boolean }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [filters, setFilters] = useState({
    lifecycle: '',
    ownerId: '',
    industry: '',
    size: '',
    tag: '',
    sort: 'name',
    direction: 'asc',
    includeArchived: false,
    page: 1,
  });
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const load = async (search = text, nextFilters = filters) => {
    setState('loading');
    try {
      const query = new URLSearchParams({
        text: search,
        page: String(nextFilters.page),
        sort: nextFilters.sort,
        direction: nextFilters.direction,
      });
      for (const [key, value] of Object.entries({
        lifecycle: nextFilters.lifecycle,
        ownerId: nextFilters.ownerId,
        industry: nextFilters.industry,
        size: nextFilters.size,
        tag: nextFilters.tag,
      }))
        if (value) query.set(key, value);
      if (nextFilters.includeArchived) query.set('includeArchived', 'true');
      const response = await fetch(`/api/companies?${query}`);
      if (!response.ok) throw new Error('Unable to load companies.');
      const body = await response.json();
      setCompanies(body.items);
      setTotal(body.total);
      setState('ready');
    } catch {
      setError('Companies could not be loaded. Try again.');
      setState('error');
    }
  };
  useEffect(() => {
    void load('');
  }, []);
  const exportQuery = new URLSearchParams();
  if (text) exportQuery.set('text', text);
  for (const [key, value] of Object.entries({
    lifecycle: filters.lifecycle,
    ownerId: filters.ownerId,
    industry: filters.industry,
    size: filters.size,
    tag: filters.tag,
  }))
    if (value) exportQuery.set(key, value);
  if (filters.includeArchived) exportQuery.set('includeArchived', 'true');
  const companyExportHref = `/api/exports/companies.csv${exportQuery.size ? `?${exportQuery}` : ''}`;
  return (
    <section aria-labelledby="companies-heading">
      <h2 id="companies-heading">Companies</h2>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          Search companies
          <input value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button>Search</button>
      </form>
      <form
        aria-label="Company filters"
        onSubmit={(event) => {
          event.preventDefault();
          const next = { ...filters, page: 1 };
          setFilters(next);
          void load(text, next);
        }}
      >
        <label>
          Lifecycle filter
          <select
            value={filters.lifecycle}
            onChange={(event) => setFilters({ ...filters, lifecycle: event.target.value })}
          >
            <option value="">All lifecycles</option>
            <option value="lead">Lead</option>
            <option value="prospect">Prospect</option>
            <option value="customer">Customer</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label>
          Owner filter
          <input
            value={filters.ownerId}
            onChange={(event) => setFilters({ ...filters, ownerId: event.target.value })}
          />
        </label>
        <label>
          Industry filter
          <input
            value={filters.industry}
            onChange={(event) => setFilters({ ...filters, industry: event.target.value })}
          />
        </label>
        <label>
          Size filter
          <input
            value={filters.size}
            onChange={(event) => setFilters({ ...filters, size: event.target.value })}
          />
        </label>
        <label>
          Tag filter
          <input
            value={filters.tag}
            onChange={(event) => setFilters({ ...filters, tag: event.target.value })}
          />
        </label>
        <label>
          Sort by
          <select
            value={filters.sort}
            onChange={(event) => setFilters({ ...filters, sort: event.target.value })}
          >
            <option value="name">Name</option>
            <option value="createdAt">Created</option>
            <option value="updatedAt">Updated</option>
            <option value="lifecycle">Lifecycle</option>
          </select>
        </label>
        <label>
          Sort direction
          <select
            value={filters.direction}
            onChange={(event) => setFilters({ ...filters, direction: event.target.value })}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) => setFilters({ ...filters, includeArchived: event.target.checked })}
          />{' '}
          Include archived companies
        </label>
        <button>Apply filters</button>
      </form>
      <a href={companyExportHref} download>
        Export filtered companies
      </a>
      {canWrite && (
        <form
          aria-label="Create company"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const response = await fetch('/api/companies', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: form.get('name'),
                externalReference: form.get('externalReference'),
                website: form.get('website'),
                phone: form.get('phone'),
                industry: form.get('industry'),
                size: form.get('size'),
                address: form.get('address'),
                lifecycleStatus: form.get('lifecycleStatus'),
                ownerId: form.get('ownerId') || undefined,
                tags: String(form.get('tags') || '')
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                description: form.get('description'),
              }),
            });
            if (!response.ok) {
              const body = await response.json();
              setError(body.error?.message || 'Company could not be saved.');
              return;
            }
            formElement.reset();
            await load('');
          }}
        >
          <h3>Add company</h3>
          <label>
            Name
            <input name="name" required maxLength={200} />
          </label>
          <label>
            External reference
            <input name="externalReference" maxLength={100} />
          </label>
          <label>
            Website
            <input name="website" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Industry
            <input name="industry" />
          </label>
          <label>
            Size
            <input name="size" />
          </label>
          <label>
            Address
            <input name="address" />
          </label>
          <label>
            Lifecycle status
            <select name="lifecycleStatus" defaultValue="lead">
              <option value="lead">Lead</option>
              <option value="prospect">Prospect</option>
              <option value="customer">Customer</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Owner ID
            <input name="ownerId" />
          </label>
          <label>
            Tags
            <input name="tags" placeholder="Comma separated" />
          </label>
          <label>
            Description
            <textarea name="description" />
          </label>
          <button type="submit">Create company</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {state === 'loading' && <p aria-live="polite">Loading companies…</p>}
      {state === 'error' && <button onClick={() => void load()}>Try again</button>}
      {state === 'ready' && (
        <>
          <ul aria-label="Company results">
            {companies.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  onClick={async () => {
                    const response = await fetch(`/api/companies/${company.id}`);
                    if (!response.ok)
                      return setError('Company details could not be loaded. Try again.');
                    setDetail(await response.json());
                  }}
                >
                  {company.name}
                </button>{' '}
                <span>{company.lifecycle_status}</span>
                {company.external_reference && <span> · {company.external_reference}</span>}
              </li>
            ))}
            {!companies.length && <li>No companies match these filters.</li>}
          </ul>
          <nav aria-label="Company pagination">
            <button
              disabled={filters.page === 1}
              onClick={() => {
                const next = { ...filters, page: filters.page - 1 };
                setFilters(next);
                void load(text, next);
              }}
            >
              Previous companies
            </button>
            <span>Page {filters.page}</span>
            <button
              disabled={companies.length === 0 || filters.page * 25 >= total}
              onClick={() => {
                const next = { ...filters, page: filters.page + 1 };
                setFilters(next);
                void load(text, next);
              }}
            >
              Next companies
            </button>
          </nav>
          {detail && (
            <section aria-labelledby="company-detail-heading">
              <h3 id="company-detail-heading">{detail.name}</h3>
              <p>{detail.description || 'No description provided.'}</p>
              <dl>
                <dt>Contacts</dt>
                <dd>{detail.contacts.length}</dd>
                <dt>Activities</dt>
                <dd>{detail.activities.length}</dd>
                <dt>Deals</dt>
                <dd>{detail.deals.length}</dd>
                <dt>Tasks</dt>
                <dd>{detail.tasks.length}</dd>
                <dt>Owner</dt>
                <dd>{detail.owner_id || 'Unassigned'}</dd>
              </dl>
              <h4>Related records</h4>
              <ul aria-label="Company related records">
                {detail.contacts.map((record) => (
                  <li key={record.id}>
                    Contact: {record.first_name} {record.last_name}
                  </li>
                ))}
                {detail.deals.map((record) => (
                  <li key={record.id}>Deal: {record.name}</li>
                ))}
                {detail.tasks.map((record) => (
                  <li key={record.id}>Task: {record.title}</li>
                ))}
                {!detail.contacts.length &&
                  !detail.activities.length &&
                  !detail.deals.length &&
                  !detail.tasks.length && <li>No related records.</li>}
              </ul>
              <h4>Activity timeline</h4>
              <ul aria-label="Company activity timeline">
                {detail.activities.map((record) => (
                  <li key={record.id}>
                    {record.subject} · {record.type} · {record.creatorName} ·{' '}
                    {new Date(record.occurredAt).toLocaleString()}
                  </li>
                ))}
                {!detail.activities.length && <li>No activity recorded for this company.</li>}
              </ul>
              <h4>Change history</h4>
              <ul aria-label="Company change history">
                {detail.history.map((event) => (
                  <li key={event.id}>
                    {event.action} · {new Date(event.created_at).toLocaleString()}
                  </li>
                ))}
                {!detail.history.length && <li>No company changes recorded.</li>}
              </ul>
              {canWrite && (
                <>
                  <form
                    aria-label="Edit company"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const response = await fetch(`/api/companies/${detail.id}`, {
                        method: 'PUT',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          name: form.get('name'),
                          externalReference: form.get('externalReference'),
                          website: form.get('website'),
                          phone: form.get('phone'),
                          industry: form.get('industry'),
                          size: form.get('size'),
                          address: form.get('address'),
                          lifecycleStatus: form.get('lifecycleStatus'),
                          ownerId: form.get('ownerId') || undefined,
                          tags: String(form.get('tags') || '')
                            .split(',')
                            .map((tag) => tag.trim())
                            .filter(Boolean),
                          description: form.get('description'),
                          version: detail.version,
                        }),
                      });
                      if (!response.ok) {
                        const body = await response.json();
                        setError(body.error?.message || 'Company could not be updated.');
                        return;
                      }
                      const updated = await response.json();
                      const detailResponse = await fetch(`/api/companies/${updated.id}`);
                      if (!detailResponse.ok)
                        return setError('Company details could not be refreshed.');
                      setDetail(await detailResponse.json());
                      await load('');
                    }}
                  >
                    <h4>Edit company</h4>
                    <label>
                      Name
                      <input name="name" required defaultValue={detail.name} />
                    </label>
                    <label>
                      External reference
                      <input
                        name="externalReference"
                        defaultValue={detail.external_reference || ''}
                      />
                    </label>
                    <label>
                      Website
                      <input name="website" defaultValue={detail.website || ''} />
                    </label>
                    <label>
                      Phone
                      <input name="phone" defaultValue={detail.phone || ''} />
                    </label>
                    <label>
                      Industry
                      <input name="industry" defaultValue={detail.industry || ''} />
                    </label>
                    <label>
                      Size
                      <input name="size" defaultValue={detail.size || ''} />
                    </label>
                    <label>
                      Address
                      <input name="address" defaultValue={detail.address || ''} />
                    </label>
                    <label>
                      Lifecycle status
                      <select name="lifecycleStatus" defaultValue={detail.lifecycle_status}>
                        <option value="lead">Lead</option>
                        <option value="prospect">Prospect</option>
                        <option value="customer">Customer</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    <label>
                      Owner ID
                      <input name="ownerId" defaultValue={detail.owner_id || ''} />
                    </label>
                    <label>
                      Tags
                      <input name="tags" defaultValue={JSON.parse(detail.tags_json).join(', ')} />
                    </label>
                    <label>
                      Description
                      <textarea name="description" defaultValue={detail.description} />
                    </label>
                    <button type="submit">Save company</button>
                  </form>
                  <button
                    type="button"
                    onClick={async () => {
                      const action = detail.archived_at ? 'restore' : 'archive';
                      if (
                        action === 'archive' &&
                        !window.confirm('Archive this company? Its history will remain available.')
                      )
                        return;
                      const response = await fetch(`/api/companies/${detail.id}/${action}`, {
                        method: 'POST',
                      });
                      if (!response.ok)
                        return setError('Company lifecycle change could not be saved.');
                      const updated = await response.json();
                      const detailResponse = await fetch(`/api/companies/${updated.id}`);
                      if (!detailResponse.ok)
                        return setError('Company details could not be refreshed.');
                      setDetail(await detailResponse.json());
                      await load('');
                    }}
                  >
                    {detail.archived_at ? 'Restore company' : 'Archive company'}
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

type Activity = {
  id: string;
  type: string;
  subject: string;
  body: string;
  occurredAt: string;
  creatorName: string;
  participantNamesJson: string;
  companyLabel: string | null;
  contactLabel: string | null;
  dealLabel: string | null;
  version: number;
};

function Activities({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [type, setType] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [relatedRecordId, setRelatedRecordId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [snapshotCreatedAt, setSnapshotCreatedAt] = useState('');
  const [cursors, setCursors] = useState<Array<{ occurredAt: string; id: string } | null>>([null]);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState('');
  const load = async (
    nextPage = page,
    cursor = cursors[nextPage - 1],
    snapshot = snapshotCreatedAt,
  ) => {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (type) query.set('type', type);
    if (authorId) query.set('authorId', authorId);
    if (relatedRecordId) query.set('relatedRecordId', relatedRecordId);
    if (from) query.set('from', new Date(from).toISOString());
    if (to) query.set('to', new Date(to).toISOString());
    if (snapshot) query.set('snapshotCreatedAt', snapshot);
    if (cursor) {
      query.set('cursorOccurredAt', cursor.occurredAt);
      query.set('cursorId', cursor.id);
    }
    const response = await fetch(`/api/activities?${query}`);
    if (!response.ok) return setNotice('Activities could not be loaded. Try again.');
    const body = await response.json();
    setItems(body.items);
    setTotal(body.total);
    setPage(nextPage);
    setSnapshotCreatedAt(body.snapshotCreatedAt);
    setCursors((current) => {
      const next = [...current];
      next[nextPage] = body.nextCursor;
      return next;
    });
  };
  useEffect(() => {
    void load(1);
  }, []);
  const payload = (form: FormData) => ({
    type: form.get('type'),
    subject: form.get('subject'),
    body: form.get('body'),
    occurredAt: new Date(String(form.get('occurredAt'))).toISOString(),
    participantNames: String(form.get('participants') || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    companyId: String(form.get('companyId') || '') || null,
    contactId: String(form.get('contactId') || '') || null,
    dealId: String(form.get('dealId') || '') || null,
  });
  return (
    <section aria-labelledby="activities-heading">
      <h2 id="activities-heading">Activities</h2>
      <p className="subtle">
        Activity facts and links are permanent. Creators and owners can amend descriptive notes for
        15 minutes after recording.
      </p>
      <form
        aria-label="Activity filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSnapshotCreatedAt('');
          setCursors([null]);
          void load(1, null, '');
        }}
      >
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All activity types</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="note">Note</option>
            <option value="status_change">Status change</option>
          </select>
        </label>
        <label>
          Author ID
          <input value={authorId} onChange={(event) => setAuthorId(event.target.value)} />
        </label>
        <label>
          Related record ID
          <input
            value={relatedRecordId}
            onChange={(event) => setRelatedRecordId(event.target.value)}
          />
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button>Apply filters</button>
      </form>
      {canWrite && (
        <form
          aria-label="Log activity"
          onSubmit={async (event) => {
            event.preventDefault();
            setNotice('');
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const response = await fetch('/api/activities', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...payload(form),
                followUp: form.get('followUpTitle')
                  ? {
                      title: form.get('followUpTitle'),
                      dueAt: form.get('followUpDueAt')
                        ? new Date(String(form.get('followUpDueAt'))).toISOString()
                        : null,
                      priority: form.get('followUpPriority'),
                    }
                  : undefined,
              }),
            });
            if (!response.ok) {
              const body = await response.json();
              return setNotice(body.error?.message || 'Activity could not be recorded.');
            }
            formElement.reset();
            setNotice('Activity recorded.');
            setSnapshotCreatedAt('');
            setCursors([null]);
            await load(1, null, '');
          }}
        >
          <h3>Log activity</h3>
          <label>
            Type
            <select name="type" defaultValue="call">
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
              <option value="status_change">Status change</option>
            </select>
          </label>
          <label>
            Subject
            <input name="subject" required maxLength={300} />
          </label>
          <label>
            Occurred at
            <input name="occurredAt" type="datetime-local" required />
          </label>
          <label>
            Notes
            <textarea name="body" maxLength={10000} />
          </label>
          <label>
            Participants
            <input name="participants" placeholder="Comma separated names" />
          </label>
          <label>
            Company ID
            <input name="companyId" />
          </label>
          <label>
            Contact ID
            <input name="contactId" />
          </label>
          <label>
            Deal ID
            <input name="dealId" />
          </label>
          <fieldset>
            <legend>Optional linked follow-up</legend>
            <label>
              Task title
              <input name="followUpTitle" />
            </label>
            <label>
              Due at
              <input name="followUpDueAt" type="datetime-local" />
            </label>
            <label>
              Priority
              <select name="followUpPriority" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </fieldset>
          <button type="submit">Record activity</button>
        </form>
      )}
      {notice && <p role="alert">{notice}</p>}
      <ul aria-label="Activity timeline">
        {items.map((activity) => (
          <li key={activity.id}>
            <button type="button" onClick={() => setSelected(activity)}>
              {activity.subject}
            </button>{' '}
            <span>
              {activity.type} · {new Date(activity.occurredAt).toLocaleString()} ·{' '}
              {activity.creatorName}
            </span>
            {(activity.companyLabel || activity.contactLabel || activity.dealLabel) && (
              <small>
                {' '}
                ·{' '}
                {[activity.companyLabel, activity.contactLabel, activity.dealLabel]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            )}
          </li>
        ))}
        {!items.length && <li>No activities match these filters.</li>}
      </ul>
      <nav aria-label="Activity pagination">
        <button disabled={page === 1} onClick={() => void load(page - 1, cursors[page - 2])}>
          Previous activities
        </button>
        <span>Page {page}</span>
        <button disabled={!cursors[page]} onClick={() => void load(page + 1, cursors[page])}>
          Next activities
        </button>
      </nav>
      {selected && (
        <section aria-labelledby="activity-detail-heading">
          <h3 id="activity-detail-heading">{selected.subject}</h3>
          <p>{selected.body || 'No notes recorded.'}</p>
          <p>
            Recorded by {selected.creatorName} · {new Date(selected.occurredAt).toLocaleString()}
          </p>
          {canWrite && (
            <form
              aria-label="Edit activity"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const response = await fetch(`/api/activities/${selected.id}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    subject: form.get('subject'),
                    body: form.get('body'),
                    participantNames: String(form.get('participants') || '')
                      .split(',')
                      .map((name) => name.trim())
                      .filter(Boolean),
                    version: selected.version,
                  }),
                });
                if (!response.ok) {
                  const body = await response.json();
                  return setNotice(body.error?.message || 'Activity could not be updated.');
                }
                setSelected(await response.json());
                setNotice('Activity updated.');
                await load(page, cursors[page - 1]);
              }}
            >
              <h4>Edit activity notes</h4>
              <label>
                Subject
                <input name="subject" required defaultValue={selected.subject} />
              </label>
              <label>
                Notes
                <textarea name="body" defaultValue={selected.body} />
              </label>
              <label>
                Participants
                <input
                  name="participants"
                  defaultValue={JSON.parse(selected.participantNamesJson || '[]').join(', ')}
                />
              </label>
              <button type="submit">Save activity notes</button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}

function Imports({ canWrite }: { canWrite: boolean }) {
  const [resource, setResource] = useState<'companies' | 'contacts'>('companies');
  const [csv, setCsv] = useState('name,external reference\nExample AB,EXAMPLE-1');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState('');
  const headers = csv
    .split(/\r?\n/, 1)[0]
    .split(',')
    .map((header) => header.trim());
  const headerForTarget = (target: string) =>
    headers.find((header) => header.toLowerCase().replace(/[^a-z0-9]/g, '') === target) || '';
  const targets =
    resource === 'companies'
      ? [
          'name',
          'externalreference',
          'website',
          'phone',
          'industry',
          'size',
          'address',
          'lifecyclestatus',
          'tags',
          'description',
        ]
      : [
          'firstname',
          'lastname',
          'email',
          'phone',
          'jobtitle',
          'status',
          'tags',
          'communicationpreference',
        ];
  const resolvedMapping = Object.fromEntries(
    targets.map((target) => [target, mapping[target] ?? headerForTarget(target)]),
  );
  const createPreview = async () => {
    setMessage('Preparing preview…');
    const response = await fetch('/api/imports/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource, csv, mapping: resolvedMapping }),
    });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error?.message || 'Preview could not be created.');
    setPreview(body);
    setMessage(`${body.validRows} rows are ready; invalid or duplicate rows will not be imported.`);
  };
  return (
    <section aria-labelledby="imports-heading">
      <h2 id="imports-heading">Imports and exports</h2>
      <p>Preview CSV rows before committing. Existing records are never merged automatically.</p>
      <label>
        Record type{' '}
        <select value={resource} onChange={(event) => setResource(event.target.value as any)}>
          <option value="companies">Companies</option>
          <option value="contacts">Contacts</option>
        </select>
      </label>
      <label>
        CSV content{' '}
        <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} />
      </label>
      <fieldset>
        <legend>Column mapping</legend>
        {targets.map((target) => (
          <label key={target}>
            {target}
            <select
              value={mapping[target] ?? headerForTarget(target)}
              onChange={(event) => setMapping({ ...mapping, [target]: event.target.value })}
            >
              <option value="">Do not import</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      {canWrite && <button onClick={() => void createPreview()}>Preview import</button>}
      {resource === 'contacts' && (
        <a href="/api/exports/contacts.csv" download>
          Export contacts
        </a>
      )}
      {message && <p role="status">{message}</p>}
      {preview && (
        <>
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row: any) => (
                <tr key={row.line}>
                  <td>{row.line}</td>
                  <td>
                    {row.errors.join(' ') ||
                      (row.duplicate ? `Possible duplicate: ${row.duplicate.name}` : 'Ready')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={async () => {
              const response = await fetch(`/api/imports/${preview.id}/commit`, { method: 'POST' });
              setMessage(response.ok ? 'Import committed.' : 'Import could not be committed.');
            }}
            disabled={!canWrite || !preview.validRows}
          >
            Commit valid rows
          </button>
        </>
      )}
    </section>
  );
}
function Tasks({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [due, setDue] = useState('');
  const [mine, setMine] = useState(false);
  const [relation, setRelation] = useState('');
  const load = async (nextDue = due) => {
    const query = new URLSearchParams({ sort: 'dueAt' });
    if (nextDue) query.set('due', nextDue);
    if (mine) query.set('assigneeId', 'me');
    if (relation) {
      const [kind, id] = relation.split(':');
      query.set('relation', kind);
      query.set('relationId', id);
    }
    const response = await fetch(`/api/tasks?${query}`);
    if (response.ok) setItems((await response.json()).items);
  };
  useEffect(() => {
    void load();
  }, []);
  const action = async (id: string, name: string) => {
    const response = await fetch(`/api/tasks/${id}/${name}`, { method: 'POST' });
    if (response.ok) {
      setMessage(
        `Task ${name === 'archive' ? 'archived' : name === 'complete' ? 'completed' : 'reopened'}.`,
      );
      await load();
    }
  };
  const rename = async (task: any) => {
    const title = window.prompt('Task title', task.title);
    if (!title) return;
    const response = await fetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        description: task.description || '',
        assigneeId: task.assignee_id,
        dueAt: task.due_at,
        priority: task.priority,
        status: task.status,
        companyId: task.company_id,
        contactId: task.contact_id,
        dealId: task.deal_id,
        version: task.version,
      }),
    });
    if (response.status === 409) setMessage('This task changed. Refresh it before saving.');
    else if (response.ok) {
      setMessage('Task updated.');
      await load();
    }
  };
  return (
    <section aria-labelledby="tasks-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operations · UTC</p>
          <h1 id="tasks-heading">Tasks</h1>
        </div>
      </div>
      <form
        aria-label="Task views"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          Due state
          <select value={due} onChange={(event) => setDue(event.target.value)}>
            <option value="">All active tasks</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={mine}
            onChange={(event) => setMine(event.target.checked)}
          />{' '}
          Assigned to me
        </label>
        <label>
          Related record
          <input
            value={relation}
            placeholder="company:co_acme"
            onChange={(event) => setRelation(event.target.value)}
          />
        </label>
        <button>Apply view</button>
      </form>
      {canWrite && (
        <form
          aria-label="Create task"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const response = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                title: form.get('title'),
                description: form.get('description'),
                dueAt: form.get('dueAt') ? new Date(String(form.get('dueAt'))).toISOString() : null,
                priority: form.get('priority'),
                assigneeId: form.get('assigneeId') || null,
                companyId: form.get('companyId') || null,
                contactId: form.get('contactId') || null,
              }),
            });
            if (response.ok) {
              e.currentTarget.reset();
              setMessage('Task created.');
              await load();
            }
          }}
        >
          <h2>Create task</h2>
          <label>
            Title
            <input name="title" required />
          </label>
          <label>
            Description
            <textarea name="description" />
          </label>
          <label>
            Due time
            <input name="dueAt" type="datetime-local" />
          </label>
          <label>
            Priority
            <select name="priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Assignee ID
            <input name="assigneeId" />
          </label>
          <label>
            Company ID
            <input name="companyId" />
          </label>
          <label>
            Contact ID
            <input name="contactId" />
          </label>
          <button>Create task</button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <ul aria-label="Task results" className="task-list">
        {items.map((task) => (
          <li key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <small>{task.status}</small>
            </div>
            {canWrite &&
              (task.status === 'completed' ? (
                <button onClick={() => void action(task.id, 'reopen')}>Reopen task</button>
              ) : (
                <button onClick={() => void action(task.id, 'complete')}>Complete task</button>
              ))}
            {canWrite && (
              <button
                onClick={() => void action(task.id, task.archived_at ? 'restore' : 'archive')}
              >
                {task.archived_at ? 'Restore task' : 'Archive task'}
              </button>
            )}
            {canWrite && <button onClick={() => void rename(task)}>Edit task</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Deals({ canWrite, canConfigure }: { canWrite: boolean; canConfigure: boolean }) {
  const [deals, setDeals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [stages, setStages] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const load = (stage = stageFilter, status = statusFilter) => {
    const query = new URLSearchParams();
    if (stage) query.set('stageId', stage);
    if (status) query.set('status', status);
    if (includeArchived) query.set('includeArchived', 'true');
    return Promise.all([
      fetch(`/api/deals?${query}`).then((r) => r.json()),
      fetch('/api/pipeline/stages').then((r) => r.json()),
    ]).then(([list, pipeline]) => {
      setDeals(list.items || []);
      setTotal(list.total || 0);
      setStages(pipeline || []);
    });
  };
  useEffect(() => {
    load().catch(() => setError('Deals could not be loaded.'));
  }, []);
  return (
    <section aria-labelledby="deals-heading">
      <h2 id="deals-heading">Deals</h2>
      {error && <p role="alert">{error}</p>}
      {canWrite && (
        <form
          aria-label="Create deal"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const response = await fetch('/api/deals', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: form.get('name'),
                companyId: form.get('companyId'),
                stageId: form.get('stageId'),
                amountCents: Number(form.get('amountCents')),
                currency: form.get('currency'),
                probability: Number(form.get('probability')),
                contactIds: String(form.get('contactIds') || '')
                  .split(',')
                  .map((id) => id.trim())
                  .filter(Boolean),
              }),
            });
            if (!response.ok) return setError('Deal could not be created.');
            event.currentTarget.reset();
            void load();
          }}
        >
          <h3>New deal</h3>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Company ID
            <input name="companyId" required />
          </label>
          <label>
            Stage
            <select name="stageId" required>
              {stages
                .filter((stage) => stage.kind === 'open')
                .map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Amount (cents)
            <input name="amountCents" type="number" min="0" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="USD" required />
          </label>
          <label>
            Probability
            <input name="probability" type="number" min="0" max="100" defaultValue="0" required />
          </label>
          <label>
            Contact IDs (comma-separated)
            <input name="contactIds" />
          </label>
          <button>Create deal</button>
        </form>
      )}
      {canConfigure && (
        <form
          aria-label="Add pipeline stage"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const response = await fetch('/api/pipeline/stages', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: form.get('name'),
                position: Number(form.get('position')),
              }),
            });
            if (!response.ok) return setError('Pipeline stage could not be created.');
            event.currentTarget.reset();
            void load();
          }}
        >
          <h3>Add pipeline stage</h3>
          <label>
            Name <input name="name" required />
          </label>
          <label>
            Position{' '}
            <input name="position" type="number" min="0" defaultValue={stages.length} required />
          </label>
          <button>Add stage</button>
        </form>
      )}
      <form
        aria-label="Deal filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          Stage
          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
            <option value="">All stages</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Include archived deals
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </label>
        <button>Apply filters</button>
      </form>
      <p>{total} active deals</p>
      <div className="pipeline" aria-label="Pipeline view">
        {stages.map((stage) => (
          <section key={stage.id}>
            <h3>{stage.name}</h3>
            <ul>
              {deals
                .filter((deal) => deal.stageId === stage.id)
                .map((deal) => (
                  <li key={deal.id}>
                    <strong>{deal.name}</strong>
                    <br />
                    {deal.currency} {(deal.amountCents / 100).toLocaleString()} · {deal.probability}
                    %
                  </li>
                ))}
              {!deals.some((deal) => deal.stageId === stage.id) && <li>No deals</li>}
            </ul>
          </section>
        ))}
      </div>
      <table>
        <caption>Deals list</caption>
        <thead>
          <tr>
            <th>Name</th>
            <th>Stage</th>
            <th>Amount</th>
            <th>Probability</th>
            {canWrite && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id}>
              <td>{deal.name}</td>
              <td>{deal.stageName}</td>
              <td>
                {deal.currency} {(deal.amountCents / 100).toLocaleString()}
              </td>
              <td>{deal.probability}%</td>
              {canWrite && (
                <td>
                  <form
                    aria-label={`Update ${deal.name}`}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const action = String(form.get('action'));
                      const response =
                        action === 'edit'
                          ? await fetch(`/api/deals/${deal.id}`, {
                              method: 'PATCH',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                name: form.get('name'),
                                companyId: deal.companyId,
                                amountCents: Number(form.get('amountCents')),
                                currency: deal.currency,
                                probability: Number(form.get('probability')),
                                version: deal.version,
                              }),
                            })
                          : action === 'archive' || action === 'restore'
                            ? await fetch(`/api/deals/${deal.id}/${action}`, { method: 'POST' })
                            : await fetch(`/api/deals/${deal.id}/transition`, {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({
                                  stageId: form.get('stageId'),
                                  version: deal.version,
                                  lossReason: form.get('lossReason') || undefined,
                                }),
                              });
                      if (!response.ok)
                        return setError('Deal could not be updated. Refresh and try again.');
                      void load();
                    }}
                  >
                    <label>
                      Name
                      <input name="name" defaultValue={deal.name} required />
                    </label>
                    <label>
                      Amount (cents)
                      <input
                        name="amountCents"
                        type="number"
                        min="0"
                        defaultValue={deal.amountCents}
                        required
                      />
                    </label>
                    <label>
                      Probability
                      <input
                        name="probability"
                        type="number"
                        min="0"
                        max="100"
                        defaultValue={deal.probability}
                        required
                      />
                    </label>
                    <label>
                      Move to
                      <select name="stageId" defaultValue={deal.stageId}>
                        {stages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Loss reason
                      <input name="lossReason" />
                    </label>
                    <button name="action" value="transition">
                      Move
                    </button>
                    <button name="action" value="edit">
                      Save details
                    </button>
                    <button name="action" value="archive">
                      Archive
                    </button>
                    {deal.archivedAt && (
                      <button name="action" value="restore">
                        Restore
                      </button>
                    )}
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session')
      .then(async (response) => {
        if (response.status === 401) {
          const body = await response.json();
          if (body.error?.code === 'SESSION_EXPIRED') setExpired(true);
          return null;
        }
        if (!response.ok) throw new Error('Service unavailable');
        return response.json();
      })
      .then((current) => {
        if (active) {
          setSession(current);
          setScreen('ready');
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setScreen(error instanceof TypeError ? 'unavailable' : 'unexpected');
      });
    return () => {
      active = false;
    };
  }, []);

  if (screen === 'loading') return <main aria-busy="true">Loading Northstar CRM…</main>;
  if (screen !== 'ready') {
    return (
      <main role="alert">
        <h1>
          {screen === 'unavailable' ? 'Northstar CRM is unavailable' : 'Something went wrong'}
        </h1>
        <p>Please check the local server and try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }
  if (!session)
    return (
      <main>
        <p className="eyebrow">Northstar CRM</p>
        <h1>Sign in</h1>
        {expired && <p role="alert">Your session has expired. Please sign in again.</p>}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setError('');
            const form = new FormData(event.currentTarget);
            const response = await fetch('/api/auth/sign-in', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
            });
            setSubmitting(false);
            if (!response.ok) return setError('Email or password is incorrect.');
            setSession(await response.json());
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && <p role="alert">{error}</p>}
          <button disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </main>
    );
  return (
    <ShellApp
      role={session.role}
      user={session.user}
      workspace={session.organization}
      companiesContent={<Companies canWrite={session.role !== 'viewer'} />}
      activitiesContent={<Activities canWrite={session.role !== 'viewer'} />}
      importsContent={<Imports canWrite={session.role !== 'viewer'} />}
      dealsContent={
        <Deals canWrite={session.role !== 'viewer'} canConfigure={session.role === 'owner'} />
      }
      tasksContent={<Tasks canWrite={session.role !== 'viewer'} />}
      onSignOut={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        setSession(null);
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
