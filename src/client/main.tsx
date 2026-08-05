import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
function App() {
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
  return (
    <main>
      <p className="eyebrow">Northstar CRM</p>
      <h1>Your operational workspace is ready.</h1>
      <p>Sign-in, data management, and dashboard workflows will appear here.</p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
