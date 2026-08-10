import { useCallback, useEffect, useRef, useState } from "react";
import type { UserRole } from "../shell/navigation";
import { StatePanel } from "../ui/StatePanel";

type EntityType = "company" | "contact";
type RecordValue = {
  id: string;
  version: number;
  archivedAt: string | null;
  [key: string]: unknown;
};
type Candidate = {
  entityType: EntityType;
  left: RecordValue;
  right: RecordValue;
  reasons: Array<{ field: string; normalizedValue: string }>;
};
const companyFields = [
  "name",
  "externalReference",
  "website",
  "phone",
  "industry",
  "size",
  "address",
  "lifecycleStatus",
  "ownerMembershipId",
  "tags",
  "description",
];
const contactFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "companyId",
  "ownerMembershipId",
  "status",
  "tags",
  "communicationPreference",
];

export function DuplicateReviewPage({ role }: { role: UserRole }) {
  const [entityType, setEntityType] = useState<EntityType>("company"),
    [items, setItems] = useState<Candidate[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [review, setReview] = useState<Candidate | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/duplicates?entityType=${entityType}`);
      if (!response.ok)
        throw new Error("Duplicate suggestions could not be loaded.");
      const body = (await response.json()) as { items: Candidate[] };
      setItems(body.items);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Duplicate suggestions could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [entityType]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle owns loading state
    void load();
  }, [load]);
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Data quality</p>
          <h1>Duplicate review</h1>
          <p>
            Suggestions explain matching facts. Nothing is merged until you
            review every field and confirm.
          </p>
        </div>
      </header>
      <label>
        Record type
        <select
          value={entityType}
          onChange={(event) => setEntityType(event.target.value as EntityType)}
        >
          <option value="company">Companies</option>
          <option value="contact">Contacts</option>
        </select>
      </label>
      {error ? (
        <StatePanel
          kind="error"
          title="Could not load duplicate suggestions"
          detail={error}
          action={<button onClick={() => void load()}>Try again</button>}
        />
      ) : loading ? (
        <StatePanel kind="loading" title="Checking normalized facts" />
      ) : items.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No suggested duplicates"
          detail="No records currently share the configured normalized facts."
        />
      ) : (
        <ul className="duplicate-list">
          {items.map((item) => (
            <li key={`${item.left.id}/${item.right.id}`}>
              <article className="surface-card">
                <h2>
                  {label(item.left, item.entityType)} /{" "}
                  {label(item.right, item.entityType)}
                </h2>
                <p>
                  {item.left.archivedAt || item.right.archivedAt
                    ? "Includes an archived record. "
                    : ""}
                  Matched on{" "}
                  {item.reasons
                    .map(
                      (reason) => `${reason.field}: ${reason.normalizedValue}`,
                    )
                    .join("; ")}
                </p>
                <button
                  disabled={role === "viewer"}
                  onClick={() => setReview(item)}
                >
                  Review merge
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}
      {review && (
        <MergeDialog
          candidate={review}
          onClose={() => setReview(null)}
          onMerged={() => {
            setReview(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function MergeDialog({
  candidate,
  onClose,
  onMerged,
}: {
  candidate: Candidate;
  onClose: () => void;
  onMerged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    firstRadio = useRef<HTMLInputElement>(null),
    [survivor, setSurvivor] = useState<"left" | "right">("left"),
    [choices, setChoices] = useState<Record<string, "left" | "right">>({}),
    [confirming, setConfirming] = useState(false),
    [message, setMessage] = useState("");
  const keys =
    candidate.entityType === "company" ? companyFields : contactFields;
  useEffect(() => {
    dialog.current?.showModal();
    firstRadio.current?.focus();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  async function commit() {
    const retired = survivor === "left" ? candidate.right : candidate.left,
      chosen = candidate[survivor];
    const fields = Object.fromEntries(
      keys.map((key) => {
        const side = choices[key] ?? survivor;
        return [key, candidate[side][key] ?? null];
      }),
    );
    const response = await fetch("/api/merges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityType: candidate.entityType,
        survivorId: chosen.id,
        retiredId: retired.id,
        survivorVersion: chosen.version,
        retiredVersion: retired.version,
        fields,
      }),
    });
    if (response.ok) {
      dialog.current?.close();
      onMerged();
      return;
    }
    const body = (await response.json()) as { message?: string };
    setMessage(
      body.message ??
        "The merge could not be completed. Refresh and review again.",
    );
    setConfirming(false);
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="merge-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-body merge-review">
        <div>
          <p className="eyebrow">Explicit merge</p>
          <h2 id="merge-title">Choose survivor and field outcomes</h2>
          <p>
            The retired identifier will redirect to the survivor. Relationships
            and history will be retained.
          </p>
        </div>
        <fieldset>
          <legend>Surviving record</legend>
          {(["left", "right"] as const).map((side) => (
            <label key={side}>
              <input
                type="radio"
                ref={side === "left" ? firstRadio : undefined}
                name="survivor"
                value={side}
                checked={survivor === side}
                onChange={() => setSurvivor(side)}
              />
              {label(candidate[side], candidate.entityType)}{" "}
              {candidate[side].archivedAt ? "(archived)" : ""}
            </label>
          ))}
        </fieldset>
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Chosen value</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <th scope="row">{humanize(key)}</th>
                <td>
                  <select
                    aria-label={`Resolve ${humanize(key)}`}
                    value={choices[key] ?? survivor}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [key]: event.target.value as "left" | "right",
                      }))
                    }
                  >
                    <option value="left">{display(candidate.left[key])}</option>
                    <option value="right">
                      {display(candidate.right[key])}
                    </option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {message && <p role="alert">{message}</p>}
        {confirming && (
          <div className="warning-panel" role="alert">
            <strong>Confirm irreversible merge</strong>
            <p>
              {label(
                survivor === "left" ? candidate.right : candidate.left,
                candidate.entityType,
              )}{" "}
              will be retired and cannot become active again.
            </p>
            <button className="button-danger" onClick={() => void commit()}>
              Confirm merge
            </button>
          </div>
        )}
        <div className="dialog-actions">
          <button className="button-secondary" onClick={close}>
            Cancel
          </button>
          <button disabled={confirming} onClick={() => setConfirming(true)}>
            Review consequences
          </button>
        </div>
      </div>
    </dialog>
  );
}
const label = (record: RecordValue, type: EntityType) =>
  type === "company"
    ? String(record.name)
    : `${String(record.firstName)} ${String(record.lastName)}`;
const humanize = (value: string) =>
  value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
const display = (value: unknown) =>
  Array.isArray(value)
    ? value.join(", ")
    : value === null || value === ""
      ? "Not set"
      : String(value);
