import { useMemo, useState } from "react";
import type { UserRole } from "../shell/navigation";

type Resource = "companies" | "contacts";
type Field = { key: string; label: string; required?: boolean };
const fields: Record<Resource, Field[]> = {
  companies: [
    { key: "name", label: "Name", required: true },
    { key: "externalReference", label: "External reference" },
    { key: "website", label: "Website" },
    { key: "phone", label: "Phone" },
    { key: "industry", label: "Industry" },
    { key: "size", label: "Size" },
    { key: "address", label: "Address" },
    { key: "lifecycleStatus", label: "Lifecycle status" },
    { key: "tags", label: "Tags" },
    { key: "description", label: "Description" },
  ],
  contacts: [
    { key: "firstName", label: "First name", required: true },
    { key: "lastName", label: "Last name", required: true },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "jobTitle", label: "Job title" },
    { key: "status", label: "Status" },
    { key: "tags", label: "Tags" },
    { key: "communicationPreference", label: "Communication preference" },
  ],
};
type ImportRow = {
  rowNumber: number;
  status: string;
  errors: string[];
  normalized: Record<string, unknown>;
};
type ImportResult = {
  id: string;
  resource: Resource;
  sourceName: string;
  status: string;
  summary: { total: number; valid: number; warnings: number; errors: number };
  rows: ImportRow[];
};
type ApiError = { status: number; message: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw {
      status: 0,
      message:
        "The network request failed. Check your connection and try again.",
    } satisfies ApiError;
  }
  const body = (await response.json().catch(() => ({}))) as {
    import?: T;
    message?: string;
    error?: string;
  };
  if (!response.ok)
    throw {
      status: response.status,
      message:
        body.message ?? body.error ?? "The request could not be completed.",
    } satisfies ApiError;
  return (body.import ?? body) as T;
}

function parseHeaders(text: string): string[] {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const headers: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      headers.push(value.trim());
      value = "";
    } else value += char;
  }
  headers.push(value.trim());
  return headers.filter(Boolean);
}

export function ImportsPage({ role }: { role: UserRole }) {
  const canImport = role !== "viewer";
  const [resource, setResource] = useState<Resource>("companies");
  const [sourceName, setSourceName] = useState("");
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [exportQuery, setExportQuery] = useState("");
  const [exportLifecycle, setExportLifecycle] = useState("");
  const selectedFields = fields[resource];
  const clean = preview?.summary.errors === 0 && preview.summary.warnings === 0;
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (exportQuery.trim()) params.set("q", exportQuery.trim());
    if (resource === "companies" && exportLifecycle)
      params.set("lifecycle", exportLifecycle);
    if (resource === "contacts" && exportLifecycle)
      params.set("status", exportLifecycle);
    const query = params.toString();
    return `/api/exports/${resource}.csv${query ? `?${query}` : ""}`;
  }, [exportQuery, exportLifecycle, resource]);

  function chooseFile(file: File | undefined) {
    setMessage("");
    setPreview(null);
    if (!file) return;
    if (file.size > 512 * 1024) {
      setCsv("");
      setHeaders([]);
      setMessage("CSV files may not exceed 512 KiB.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsv("");
      setHeaders([]);
      setMessage("Choose a UTF-8 CSV file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsv(text);
      setSourceName(file.name);
      setHeaders(parseHeaders(text));
      setMapping({});
    };
    reader.onerror = () =>
      setMessage("This file could not be read as UTF-8 CSV.");
    reader.readAsText(file, "UTF-8");
  }
  async function submitPreview(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setPreview(null);
    const missing = selectedFields.filter(
      (field) => field.required && !mapping[field.key],
    );
    if (!sourceName || !csv || missing.length) {
      setMessage(
        missing.length
          ? `Map required fields: ${missing.map((field) => field.key).join(", ")}.`
          : "Choose a CSV file before requesting a preview.",
      );
      return;
    }
    setBusy(true);
    try {
      setPreview(
        await request<ImportResult>("/api/imports/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resource, sourceName, csv, mapping }),
        }),
      );
    } catch (error) {
      const e = error as ApiError;
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || !clean) return;
    setBusy(true);
    setMessage("");
    try {
      setPreview(
        await request<ImportResult>(
          `/api/imports/${encodeURIComponent(preview.id)}/commit`,
          { method: "POST" },
        ),
      );
    } catch (error) {
      const e = error as ApiError;
      setMessage(
        e.status === 409 ? `Import conflict: ${e.message}` : e.message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Data operations</p>
          <h1>Imports</h1>
          <p className="page-summary">
            Preview safe, mapped CSV changes and download filtered records.
          </p>
        </div>
      </header>
      <section
        className="surface imports-export"
        aria-labelledby="export-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Export</p>
            <h2 id="export-title">Download records</h2>
          </div>
          <a href={exportUrl} download>
            Download CSV
          </a>
        </div>
        <div className="import-controls">
          <label>
            Resource
            <select
              value={resource}
              onChange={(event) => {
                setResource(event.target.value as Resource);
                setPreview(null);
                setHeaders([]);
                setMapping({});
              }}
            >
              <option value="companies">Companies</option>
              <option value="contacts">Contacts</option>
            </select>
          </label>
          <label>
            Search
            <input
              value={exportQuery}
              onChange={(event) => setExportQuery(event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            {resource === "companies" ? "Lifecycle" : "Status"}
            <input
              value={exportLifecycle}
              onChange={(event) => setExportLifecycle(event.target.value)}
              placeholder={resource === "companies" ? "customer" : "active"}
            />
          </label>
        </div>
      </section>
      {canImport ? (
        <section
          className="surface import-workspace"
          aria-labelledby="import-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Import</p>
              <h2 id="import-title">Preview a CSV</h2>
            </div>
          </div>
          <form onSubmit={submitPreview} className="import-form">
            <label>
              Resource
              <select
                value={resource}
                onChange={(event) => {
                  setResource(event.target.value as Resource);
                  setPreview(null);
                  setMapping({});
                }}
              >
                <option value="companies">Companies</option>
                <option value="contacts">Contacts</option>
              </select>
            </label>
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
            </label>
            <p className="field-help">
              UTF-8 CSV, up to 512 KiB and 2,000 data rows.
            </p>
            {headers.length > 0 && (
              <fieldset>
                <legend>Map CSV columns</legend>
                <div className="mapping-grid">
                  {selectedFields.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      {field.required ? " (required)" : ""}
                      <select
                        aria-label={`${field.label}${field.required ? " (required)" : ""}`}
                        value={mapping[field.key] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Not mapped</option>
                        {headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <button type="submit" disabled={busy || headers.length === 0}>
              {busy ? "Preparing preview…" : "Request preview"}
            </button>
          </form>
        </section>
      ) : (
        <p className="viewer-note" role="status">
          Viewer access is read-only. Import controls are unavailable.
        </p>
      )}
      {message && (
        <div className="inline-error" role="alert">
          <strong>Could not complete this request</strong>
          <p>{message}</p>
        </div>
      )}
      {preview && (
        <section
          className="surface import-preview"
          aria-labelledby="preview-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {preview.status === "committed" ? "Committed" : "Preview ready"}
              </p>
              <h2 id="preview-title">{preview.sourceName}</h2>
            </div>
            {preview.status === "committed" ? (
              <span className="status-badge">Committed successfully</span>
            ) : (
              <button onClick={() => void commit()} disabled={!clean || busy}>
                {busy ? "Committing…" : "Commit clean preview"}
              </button>
            )}
          </div>
          <div className="metrics import-metrics">
            <div className="metric">
              <span>Total</span>
              <strong>{preview.summary.total}</strong>
            </div>
            <div className="metric">
              <span>Valid</span>
              <strong className="tone-positive">{preview.summary.valid}</strong>
            </div>
            <div className="metric">
              <span>Warnings</span>
              <strong className="tone-warning">
                {preview.summary.warnings}
              </strong>
            </div>
            <div className="metric">
              <span>Errors</span>
              <strong
                className={
                  preview.summary.errors ? "tone-warning" : "tone-positive"
                }
              >
                {preview.summary.errors}
              </strong>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Import row results</caption>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Values</th>
                  <th>Errors and warnings</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <th scope="row">{row.rowNumber}</th>
                    <td>
                      <span
                        className={`status-badge import-status-${row.status}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {Object.entries(row.normalized).map(([key, value]) => (
                        <span className="import-value" key={key}>
                          <strong>{key}:</strong>{" "}
                          {Array.isArray(value)
                            ? value.join(", ")
                            : String(value)}
                        </span>
                      ))}
                    </td>
                    <td>{row.errors.length ? row.errors.join(" ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!preview && !message && (
        <p className="empty-state">
          Choose a resource and CSV file to begin. Nothing has been changed.
        </p>
      )}
    </>
  );
}
