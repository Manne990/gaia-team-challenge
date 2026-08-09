import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/app';

describe('CRM application shell', () => {
  it('renders operational navigation and changes to the companies workspace', async () => {
    const user = userEvent.setup();
    render(
      <App
        role="owner"
        user={{ displayName: 'Northstar Owner' }}
        workspace={{ id: 'org_northstar', name: 'Northstar Demo' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Good morning, Northstar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Companies' }));
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search companies' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Companies list' })).toBeInTheDocument();
  });

  it('renders deliberate loading, error, not-found, and conflict states', async () => {
    const user = userEvent.setup();
    render(
      <App
        role="owner"
        user={{ displayName: 'Northstar Owner' }}
        workspace={{ id: 'org_northstar', name: 'Northstar Demo' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Activities' }));
    expect(screen.getByRole('heading', { name: 'Loading activity' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deals' }));
    expect(screen.getByRole('heading', { name: 'Couldn’t load deals' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(
      screen.getByRole('heading', { name: 'This task changed elsewhere' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Audit' }));
    expect(screen.getByRole('heading', { name: 'No audit event found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Administration' })).toBeInTheDocument();
  });

  it('hides owner-only navigation for an authenticated viewer role', () => {
    render(
      <App
        role="viewer"
        user={{ displayName: 'Northstar Viewer' }}
        workspace={{ id: 'org_northstar', name: 'Northstar Demo' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Companies' })).toBeInTheDocument();
  });

  it('uses the authenticated workspace instead of Northstar demo content', async () => {
    const user = userEvent.setup();
    render(
      <App
        role="owner"
        user={{ displayName: 'Outside Owner' }}
        workspace={{ id: 'org_outside', name: 'Outside Demo' }}
      />,
    );
    expect(screen.getByText('Outside Demo', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Northstar Demo', { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Companies' }));
    expect(screen.getByText('Outside Demo account')).toBeInTheDocument();
    expect(screen.queryByText('Acme Nordic AB')).not.toBeInTheDocument();
  });

  it('restores focus to the account trigger after the dialog closes', async () => {
    const user = userEvent.setup();
    render(
      <App
        role="owner"
        user={{ displayName: 'Northstar Owner' }}
        workspace={{ id: 'org_northstar', name: 'Northstar Demo' }}
      />,
    );
    const trigger = screen.getByRole('button', { name: /Northstar Owner.*owner/ });
    trigger.focus();
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Account menu' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
