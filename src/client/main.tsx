import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Screen = 'loading' | 'ready' | 'unavailable' | 'unexpected';

function App() {
  const [screen, setScreen] = useState<Screen>('loading');

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('Service unavailable');
        if (active) setScreen('ready');
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
  return (
    <main>
      <p className="eyebrow">Northstar CRM</p>
      <h1>Your customer operations, in one place.</h1>
      <p>The CRM foundation is online. Sign-in and operational workflows are being added next.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
