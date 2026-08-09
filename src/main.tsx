import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const authenticatedRole = document.documentElement.dataset.authenticatedRole;
const role =
  authenticatedRole === 'owner' || authenticatedRole === 'member' ? authenticatedRole : 'viewer';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App role={role} />
  </StrictMode>,
);
