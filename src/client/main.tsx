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
};
type CompanyDetail = Company & {
  description: string;
  contacts: { id: string; first_name: string; last_name: string }[];
  activities: { id: string; subject: string }[];
  deals: { id: string; name: string }[];
  tasks: { id: string; title: string }[];
};

function Companies({ canWrite }: { canWrite: boolean }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const load = async (search = text) => {
    setState('loading');
    try {
      const response = await fetch(`/api/companies?text=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error('Unable to load companies.');
      setCompanies((await response.json()).items);
      setState('ready');
    } catch {
      setError('Companies could not be loaded. Try again.');
      setState('error');
    }
  };
  useEffect(() => {
    void load('');
  }, []);
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
              </dl>
            </section>
          )}
        </>
      )}
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
