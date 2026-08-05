import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/App';
import './styles.css';

function ClientApp() {
  const [state, setState] = useState<'loading' | 'sign-in' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    fetch('/api/health')
      .then((response) => setState(response.ok ? 'sign-in' : 'unavailable'))
      .catch(() => setState('unavailable'));
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
  if (state === 'sign-in') return <SignIn onAuthenticated={() => setState('ready')} />;
  return <App />;
}

function SignIn({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    if (response.ok) return onAuthenticated();
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
