import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ConfirmDialog, ErrorState, LoadingState } from './states';

describe('application shell', () => {
  it('provides all authorized owner navigation and changes the workspace', async () => {
    const user = userEvent.setup();
    render(<App role="owner" />);

    expect(screen.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Administration' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Companies' }));
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Companies' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not expose owner administration or mutation actions to viewers', () => {
    render(<App role="viewer" />);

    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.getByText('Viewer access · read only')).toBeVisible();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });

  it('opens a labelled confirmation dialog and restores feedback after confirmation', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Complete review' }));
    expect(screen.getByRole('dialog', { name: 'Mark weekly review complete?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(screen.getByText('Weekly review marked complete.')).toBeVisible();
  });

  it('adds and completes follow-up work from the Tasks workspace', async () => {
    const user = userEvent.setup();
    const task = {
      id: 'task-1',
      title: 'Review proposal',
      description: '',
      assigneeMembershipId: 'member-1',
      dueAt: null,
      priority: 'medium',
      status: 'open',
      companyId: null,
      contactId: null,
      dealId: null,
      version: 1,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [task], actorMembershipId: 'member-1' })),
      );
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    await screen.findByText('Review proposal');
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Send contract');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...task, id: 'task-2', title: 'Send contract' })),
    );
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('Send contract')).toBeVisible();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...task, id: 'task-2', title: 'Send contract', status: 'completed' }),
      ),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Send contract' }));
    expect(await screen.findByText('Completed')).toBeVisible();
    fetchMock.mockRestore();
  });
});

describe('operational states', () => {
  it('announces loading and gives errors an actionable alert', () => {
    const retry = () => undefined;
    render(
      <>
        <LoadingState label="Loading companies" />
        <ErrorState onRetry={retry} />
      </>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading companies…');
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('keeps a confirmation dialog out of the tree until opened', () => {
    const { rerender } = render(
      <ConfirmDialog
        open={false}
        title="Delete record?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(
      <ConfirmDialog
        open
        title="Delete record?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Delete record?' })).toBeVisible();
  });
});
