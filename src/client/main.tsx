import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Screen = 'loading' | 'ready' | 'unavailable' | 'unexpected';
type Session = { user: { displayName: string; email: string }; role: string };

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
    <main>
      <p className="eyebrow">Northstar CRM</p>
      <h1>Welcome, {session.user.displayName}</h1>
      <p>You are signed in as a {session.role}.</p>
      <button
        type="button"
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          setSession(null);
        }}
      >
        Sign out
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
