import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { LogoutButton, SignInPage } from "../auth/SignInPage";
import "../auth/auth.css";
import { AppShell } from "./shell/AppShell";
import { DashboardPage } from "./shell/DashboardPage";
import { ContactsPage } from "./contacts/ContactsPage";
import { DealsPage } from "./deals/DealsPage";
import type { UserRole } from "./shell/navigation";
import { StatePanel } from "./ui/StatePanel";
import { CompaniesPage } from "./companies/CompaniesPage";
import { TasksPage } from "./tasks/TasksPage";
import { routeFromHash } from "./search/urlState";
import { ActivitiesPage } from "./activities/ActivitiesPage";
import { ImportsPage } from "./imports/ImportsPage";
import { NotificationsPage } from "./notifications/NotificationsPage";

interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
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

  useEffect(() => loadSession(), [loadSession]);

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
  if (state.kind === "signed-out") {
    return <SignInPage expired={state.expired} onSignedIn={loadSession} />;
  }
  return (
    <AppShell
      productName="Northstar CRM"
      user={{
        name: state.user.displayName,
        role: state.user.role,
        organization: "Northstar Demo",
      }}
      accountAction={
        <LogoutButton
          onLoggedOut={() => setState({ kind: "signed-out", expired: false })}
        />
      }
    >
      <WorkspacePage user={state.user} />
    </AppShell>
  );
}

function WorkspacePage({ user }: { user: SessionUser }) {
  const [location, setLocation] = useState(() => window.location.hash);
  const hash = routeFromHash();
  useEffect(() => {
    const onHashChange = () => setLocation(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  if (hash === "companies")
    return <CompaniesPage key={location} role={user.role} />;
  if (hash === "contacts")
    return <ContactsPage key={location} role={user.role} />;
  if (hash === "deals" || hash.startsWith("deals/"))
    return (
      <DealsPage
        key={location}
        role={user.role}
        initialDealId={hash.startsWith("deals/") ? hash.slice(6) : undefined}
      />
    );
  if (hash === "tasks" || hash.startsWith("tasks/"))
    return (
      <TasksPage
        key={location}
        role={user.role}
        initialTaskId={hash.startsWith("tasks/") ? hash.slice(6) : undefined}
      />
    );
  if (hash === "notifications") return <NotificationsPage />;
  if (hash === "activities") return <ActivitiesPage role={user.role} />;
  if (hash === "imports") return <ImportsPage role={user.role} />;
  return <DashboardPage userName={user.displayName} />;
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
