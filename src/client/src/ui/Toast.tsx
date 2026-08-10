export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      <span aria-hidden="true">✓</span>
      <span>{message}</span>
      <button aria-label="Dismiss notification">×</button>
    </div>
  );
}
