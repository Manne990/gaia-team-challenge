import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { BootstrapResponse } from "../../shared/api";

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
  if (state.kind === "loading")
    return (
      <StatusPanel
        title="Loading your workspace…"
        detail="Connecting to Northstar CRM."
      />
    );
  if (state.kind === "unavailable")
    return (
      <StatusPanel
        title="Northstar is temporarily unavailable"
        detail="Check your connection, then refresh the page. Your data has not been changed."
      />
    );
  return (
    <main className="shell">
      <p className="eyebrow">{state.data.product}</p>
      <h1>Your customer workspace is ready.</h1>
      <p className="lede">
        The application foundation is running. CRM modules will appear here.
      </p>
    </main>
  );
}

function StatusPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="status" aria-live="polite">
      <div className="pulse" aria-hidden="true" />
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
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
    console.error("Unexpected interface failure", { error, info });
  }
  render() {
    if (this.state.failed)
      return (
        <StatusPanel
          title="Something unexpected happened"
          detail="Refresh the page to try again. If the problem continues, contact your administrator."
        />
      );
    return this.props.children;
  }
}
