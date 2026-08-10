import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { LogoutButton, SignInPage } from "../auth/SignInPage";
import "../auth/auth.css";

interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

type AppState =
  | { kind: "loading" }
  | { kind: "signed-out"; expired: boolean }
  | { kind: "ready"; user: SessionUser }
  | { kind: "unavailable" };

export function App() {
  const [state, setState] = useState<AppState>({ kind: "loading" });
  const loadSession = useCallback(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          code?: string;
          user?: SessionUser;
        };
        if (response.status === 401) {
          setState({
            kind: "signed-out",
            expired: body.code === "SESSION_EXPIRED",
          });
          return;
        }
        if (!response.ok || !body.user) throw new Error("session unavailable");
        setState({ kind: "ready", user: body.user });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ kind: "unavailable" });
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    return loadSession();
  }, [loadSession]);
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
  if (state.kind === "signed-out")
    return <SignInPage expired={state.expired} onSignedIn={loadSession} />;
  return (
    <main className="shell">
      <p className="eyebrow">Northstar CRM</p>
      <h1>Welcome, {state.user.displayName}.</h1>
      <p className="lede">Your {state.user.role} workspace is ready.</p>
      <LogoutButton
        onLoggedOut={() => setState({ kind: "signed-out", expired: false })}
      />
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
