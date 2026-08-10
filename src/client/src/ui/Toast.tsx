export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="toast" role="status">
      <span aria-hidden="true">✓</span>
      <span>{message}</span>
      <button aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
