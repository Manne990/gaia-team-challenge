import { useEffect, useRef } from 'react';

export function LoadingState({ label = 'Loading records' }: { label?: string }) {
  return (
    <div className="operational-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{label}…</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
}: {
  title: string;
  description: string;
  actionLabel?: string;
}) {
  return (
    <div className="operational-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel ? (
        <button className="secondary-button" type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'Try again. If this keeps happening, contact your administrator.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="operational-state error-state" role="alert">
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry ? (
        <button className="secondary-button" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ToastRegion({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div className="toast-region" aria-live="polite">
      <div className="toast">
        <p>{message}</p>
        <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-description">{description}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
