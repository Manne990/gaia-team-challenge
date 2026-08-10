import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BootstrapResponse } from "../../shared/api";
import { AppShell } from "./shell/AppShell";
import { DashboardPage } from "./shell/DashboardPage";
import { StatePanel } from "./ui/StatePanel";

type AppState =
  | { kind: "loading" }
  | { kind: "ready"; data: BootstrapResponse }
  | { kind: "unavailable" };

export function App() {
  const [state, setState] = useState<AppState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bootstrap", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("bootstrap unavailable");
        setState({
          kind: "ready",
          data: (await response.json()) as BootstrapResponse,
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ kind: "unavailable" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") {
    return <StatePanel kind="loading" title="Loading your workspace" />;
  }
  if (state.kind === "unavailable") {
    return (
      <StatePanel
        kind="error"
        title="Northstar is temporarily unavailable"
        detail="Check your connection, then refresh the page. Your data has not been changed."
        action={
          <button onClick={() => window.location.reload()}>Try again</button>
        }
      />
    );
  }
  return (
    <AppShell
      productName={state.data.product}
      user={{
        name: "Alex Morgan",
        role: "owner",
        organization: "Northstar Demo",
      }}
    >
      <DashboardPage />
    </AppShell>
  );
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected interface failure", {
      errorName: error.name,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (this.state.failed) {
      return (
        <StatePanel
          kind="error"
          title="Something unexpected happened"
          detail="Refresh the page to try again. If the problem continues, contact your administrator."
        />
      );
    }
    return this.props.children;
  }
}

export function ConfirmationDialog({
  open,
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      confirmButton.current?.focus();
    }
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog ref={dialog} aria-labelledby="confirm-title" onCancel={onCancel}>
      <form method="dialog" className="dialog-body">
        <div>
          <p className="eyebrow">Confirmation required</p>
          <h2 id="confirm-title">{title}</h2>
          <p>{detail}</p>
        </div>
        <div className="dialog-actions">
          <button className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmButton}
            className="button-danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
