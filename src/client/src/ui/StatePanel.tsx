import type { ReactNode } from "react";

export type StateKind =
  "loading" | "empty" | "error" | "forbidden" | "not-found" | "conflict";

const symbols: Record<StateKind, string> = {
  loading: "···",
  empty: "○",
  error: "!",
  forbidden: "×",
  "not-found": "?",
  conflict: "↯",
};

export function StatePanel({
  kind,
  title,
  detail,
  action,
  compact = false,
}: {
  kind: StateKind;
  title: string;
  detail?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={`state-panel ${compact ? "state-panel-compact" : ""}`}
      aria-live={kind === "loading" ? "polite" : undefined}
      aria-busy={kind === "loading" || undefined}
    >
      <span className={`state-symbol state-${kind}`} aria-hidden="true">
        {symbols[kind]}
      </span>
      <div>
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
        {action && <div className="state-action">{action}</div>}
      </div>
    </section>
  );
}
