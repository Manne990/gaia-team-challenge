import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/App';
import type { UserRole } from '../ui/App';
import './styles.css';

function ClientApp() {
  const [state, setState] = useState<'loading' | 'sign-in' | 'ready' | 'unavailable'>('loading');
  const [role, setRole] = useState<UserRole>('viewer');
  const [organizationName, setOrganizationName] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const health = await fetch('/api/health');
        if (!health.ok) return setState('unavailable');
        const session = await fetch('/api/auth/me');
        if (!session.ok) return setState('sign-in');
        const value = (await session.json()) as {
          authenticated?: boolean;
          role?: string;
          organizationName?: string;
        };
        if (!value.authenticated) return setState('sign-in');
        if (value.role !== 'owner' && value.role !== 'member' && value.role !== 'viewer')
          return setState('unavailable');
        setRole(value.role);
        setOrganizationName(value.organizationName ?? '');
        setState('ready');
      } catch {
        setState('unavailable');
      }
    })();
  }, []);
  if (state === 'loading')
    return (
      <main aria-busy="true">
        <p>Loading Northstar CRM…</p>
      </main>
    );
  if (state === 'unavailable')
    return (
      <main role="alert">
        <h1>Northstar CRM is unavailable</h1>
        <p>Please check your connection and try again.</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  if (state === 'sign-in')
    return (
      <SignIn
        onAuthenticated={(nextRole, nextOrganizationName) => {
          setRole(nextRole);
          setOrganizationName(nextOrganizationName);
          setState('ready');
        }}
      />
    );
  return <App role={role} organizationName={organizationName || undefined} />;
}

function SignIn({
  onAuthenticated,
}: {
  onAuthenticated: (role: UserRole, organizationName: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    if (response.ok) {
      const session = await fetch('/api/auth/me');
      const value = (await session.json()) as { role?: UserRole; organizationName?: string };
      if (session.ok && value.role)
        return onAuthenticated(value.role, value.organizationName ?? '');
    }
    setError('Invalid email or password.');
  }
  return (
    <main className="sign-in">
      <form onSubmit={submit} aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Sign in to Northstar CRM</h1>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientApp />
  </StrictMode>,
);
