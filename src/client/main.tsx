import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/App';
import './styles.css';

function ClientApp() {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    fetch('/api/health')
      .then((response) => setState(response.ok ? 'ready' : 'unavailable'))
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
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientApp />
  </StrictMode>,
);
