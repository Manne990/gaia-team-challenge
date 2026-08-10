import { type FormEvent, useId, useState } from "react";
import "./auth.css";

export interface SignInPageProps {
  expired?: boolean;
  onSignedIn?: () => void;
}

export function SignInPage({ expired = false, onSignedIn }: SignInPageProps) {
  const emailId = useId();
  const passwordId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to sign in. Please try again.");
      onSignedIn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="sign-in-title">
      <p className="auth-eyebrow">Northstar CRM</p>
      <h1 id="sign-in-title">Welcome back</h1>
      <p className="auth-intro">Sign in to continue to your organization workspace.</p>
      {expired && <p className="auth-notice" role="status">Your session expired. Sign in again to continue.</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor={emailId}>Email address</label>
        <input id={emailId} name="email" type="email" autoComplete="username" required disabled={busy} />
        <label htmlFor={passwordId}>Password</label>
        <input id={passwordId} name="password" type="password" autoComplete="current-password" required disabled={busy} />
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  </main>;
}

export function LogoutButton({ onLoggedOut }: { onLoggedOut?: () => void }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      onLoggedOut?.();
    } finally {
      setBusy(false);
    }
  }}>{busy ? "Signing out…" : "Sign out"}</button>;
}
