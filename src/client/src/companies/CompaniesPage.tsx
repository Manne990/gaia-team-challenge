import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "../shell/navigation";
import { StatePanel } from "../ui/StatePanel";

type Company = {
  id: string;
  name: string;
  externalReference: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  size: string | null;
  address: string | null;
  lifecycleStatus: string;
  ownerMembershipId: string | null;
  ownerName: string | null;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
};
type Detail = {
  company: Company;
  contacts: Record<string, unknown>[];
  activities: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  history: Record<string, unknown>[];
};
type OwnerOption = { id: string; name: string };
type List = {
  items: Company[];
  page: number;
  pageSize: number;
  total: number;
  facets?: {
    owners: OwnerOption[];
    industries: string[];
    sizes: string[];
    tags: string[];
  };
};
type ApiError = {
  status: number;
  code?: string;
  message: string;
  issues?: string[];
};

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
    code?: string;
    error?: string;
    issues?: string[];
  };
  if (!response.ok)
    throw {
      status: response.status,
      code: body.code,
      message: body.error ?? "The request could not be completed.",
      issues: body.issues,
    } satisfies ApiError;
  return body as T;
}

const emptyFilters = {
  q: "",
  lifecycle: "",
  owner: "",
  industry: "",
  size: "",
  tag: "",
  archived: "",
};
const labels: Record<string, string> = {
  externalReference: "External reference",
  lifecycleStatus: "Lifecycle",
  ownerMembershipId: "Owner membership ID",
};

export function CompaniesPage({ role }: { role: UserRole }) {
  const canMutate = role !== "viewer";
  const [filters, setFilters] = useState(emptyFilters);
  const [sort, setSort] = useState("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<List | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<
    "loading" | "error" | "forbidden" | "not-found" | "conflict" | null
  >("loading");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    p.set("sort", sort);
    p.set("direction", direction);
    p.set("page", String(page));
    p.set("pageSize", "10");
    return p;
  }, [filters, sort, direction, page]);
  const loadList = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      setList(await request<List>(`/api/companies?${query}`));
      setState(null);
    } catch (error) {
      const e = error as ApiError;
      setState(
        e.status === 403
          ? "forbidden"
          : e.status === 404
            ? "not-found"
            : e.status === 409
              ? "conflict"
              : "error",
      );
      setMessage(e.message);
    }
  }, [query]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
  }, [loadList]);

  async function openCompany(id: string) {
    setSelectedId(id);
    setDetail(null);
    setState("loading");
    setEditing(false);
    try {
      setDetail(
        await request<Detail>(`/api/companies/${encodeURIComponent(id)}`),
      );
      setState(null);
    } catch (error) {
      const e = error as ApiError;
      setState(
        e.status === 403
          ? "forbidden"
          : e.status === 404
            ? "not-found"
            : e.status === 409
              ? "conflict"
              : "error",
      );
      setMessage(e.message);
    }
  }
  function clear() {
    setFilters(emptyFilters);
    setPage(1);
  }
  const title = selectedId ? "Company details" : "Companies";
  if (selectedId && detail && state !== "loading")
    return (
      <CompanyDetail
        detail={detail}
        owners={list?.facets?.owners ?? []}
        role={role}
        editing={editing}
        setEditing={setEditing}
        onBack={() => {
          setSelectedId(null);
          setDetail(null);
          void loadList();
        }}
        onChanged={(next) => {
          setDetail(next);
          setEditing(false);
        }}
      />
    );
  if (selectedId && state && !detail)
    return (
      <StatePanel
        kind={
          state === "loading"
            ? "loading"
            : state === "forbidden"
              ? "forbidden"
              : state === "not-found"
                ? "not-found"
                : state === "conflict"
                  ? "conflict"
                  : "error"
        }
        title={
          state === "loading" ? "Loading company" : "Could not open company"
        }
        detail={message}
        action={
          state === "loading" ? undefined : (
            <button
              onClick={() => {
                setSelectedId(null);
                setState(null);
              }}
            >
              Back to companies
            </button>
          )
        }
      />
    );
  if (state && !list)
    return (
      <StatePanel
        kind={
          state === "forbidden"
            ? "forbidden"
            : state === "not-found"
              ? "not-found"
              : state === "conflict"
                ? "conflict"
                : "error"
        }
        title={
          state === "forbidden"
            ? "Companies are unavailable"
            : state === "not-found"
              ? "Company not found"
              : state === "conflict"
                ? "Company data changed"
                : "Could not load companies"
        }
        detail={message}
        action={<button onClick={() => void loadList()}>Try again</button>}
      />
    );
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{title}</h1>
          <p className="page-summary">
            Search, maintain, and review every company in your organization.
          </p>
        </div>
        {canMutate && (
          <button
            onClick={() => {
              setSelectedId("new");
              setDetail({
                company: newCompany(),
                contacts: [],
                activities: [],
                deals: [],
                tasks: [],
                history: [],
              });
            }}
          >
            Create company
          </button>
        )}
      </header>
      <section
        className="surface companies-panel"
        aria-labelledby="company-list-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Directory</p>
            <h2 id="company-list-title">
              All companies{" "}
              {list && <span className="count-badge">{list.total}</span>}
            </h2>
          </div>
        </div>
        <div className="company-filters" aria-label="Company filters">
          <label>
            <span className="sr-only">Search companies</span>
            <input
              type="search"
              placeholder="Search companies"
              value={filters.q}
              onChange={(e) => {
                setFilters({ ...filters, q: e.target.value });
                setPage(1);
              }}
            />
          </label>
          <Filter
            label="Lifecycle"
            value={filters.lifecycle}
            options={["lead", "prospect", "customer", "former_customer"]}
            onChange={(v) => {
              setFilters({ ...filters, lifecycle: v });
              setPage(1);
            }}
          />
          <Filter
            label="Owner"
            value={filters.owner}
            options={(list?.facets?.owners ?? []).map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            onChange={(v) => {
              setFilters({ ...filters, owner: v });
              setPage(1);
            }}
          />
          <Filter
            label="Industry"
            value={filters.industry}
            options={list?.facets?.industries ?? []}
            onChange={(v) => {
              setFilters({ ...filters, industry: v });
              setPage(1);
            }}
          />
          <Filter
            label="Size"
            value={filters.size}
            options={list?.facets?.sizes ?? []}
            onChange={(v) => {
              setFilters({ ...filters, size: v });
              setPage(1);
            }}
          />
          <label>
            Tag{" "}
            <input
              value={filters.tag}
              placeholder="Tag"
              onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            />
          </label>
          <label>
            Sort{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="updatedAt">Updated</option>
              <option value="name">Name</option>
              <option value="createdAt">Created</option>
              <option value="industry">Industry</option>
              <option value="size">Size</option>
              <option value="lifecycleStatus">Lifecycle</option>
            </select>
          </label>
          <button
            className="button-secondary"
            onClick={() => setDirection(direction === "asc" ? "desc" : "asc")}
          >
            Direction: {direction}
          </button>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.archived === "include"}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  archived: e.target.checked ? "include" : "",
                })
              }
            />{" "}
            Include archived
          </label>
          <button className="button-quiet" onClick={clear}>
            Clear filters
          </button>
        </div>
        {state === "loading" ? (
          <StatePanel compact kind="loading" title="Loading companies" />
        ) : list?.items.length === 0 ? (
          <StatePanel
            compact
            kind="empty"
            title="No companies found"
            detail="Try changing or clearing your filters."
            action={
              <button className="button-secondary" onClick={clear}>
                Clear filters
              </button>
            }
          />
        ) : (
          <CompanyTable items={list?.items ?? []} onOpen={openCompany} />
        )}
        {list && (
          <footer className="table-footer">
            <span>
              Showing {list.total ? (list.page - 1) * list.pageSize + 1 : 0}–
              {Math.min(list.page * list.pageSize, list.total)} of {list.total}
            </span>
            <div>
              <button
                className="button-secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                className="button-secondary"
                disabled={page * list.pageSize >= list.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        )}
      </section>
    </>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const text = typeof option === "string" ? option : option.label;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}
function CompanyTable({
  items,
  onOpen,
}: {
  items: Company[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">Lifecycle</th>
            <th scope="col">Industry</th>
            <th scope="col">Size</th>
            <th scope="col">Owner</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((company) => (
            <tr key={company.id}>
              <th scope="row">
                <button
                  className="button-quiet company-link"
                  onClick={() => onOpen(company.id)}
                >
                  {company.name}
                </button>
                {company.externalReference && (
                  <small>{company.externalReference}</small>
                )}
                {company.archivedAt && <small>Archived</small>}
              </th>
              <td>
                <span className="status-badge">{company.lifecycleStatus}</span>
              </td>
              <td>{company.industry ?? "—"}</td>
              <td>{company.size ?? "—"}</td>
              <td>{company.ownerName ?? "Unassigned"}</td>
              <td>{new Date(company.updatedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function newCompany(): Company {
  return {
    id: "new",
    name: "",
    externalReference: null,
    website: null,
    phone: null,
    industry: null,
    size: null,
    address: null,
    lifecycleStatus: "lead",
    ownerMembershipId: null,
    ownerName: null,
    tags: [],
    description: "",
    createdAt: "",
    updatedAt: "",
    archivedAt: null,
    version: 1,
  };
}
function CompanyDetail({
  detail,
  owners,
  role,
  editing,
  setEditing,
  onBack,
  onChanged,
}: {
  detail: Detail;
  owners: OwnerOption[];
  role: UserRole;
  editing: boolean;
  setEditing: (value: boolean) => void;
  onBack: () => void;
  onChanged: (detail: Detail) => void;
}) {
  const canMutate = role !== "viewer";
  const isNew = detail.company.id === "new";
  const [form, setForm] = useState(detail.company);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "restore" | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) confirmButton.current?.focus();
  }, [confirm]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = {
      ...form,
      tags: form.tags,
      ...(isNew ? {} : { version: detail.company.version }),
    };
    try {
      const next = await request<Detail>(
        isNew ? "/api/companies" : `/api/companies/${detail.company.id}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      onChanged(next);
    } catch (e) {
      setError(e as ApiError);
    }
  }
  async function archive() {
    if (!confirm) return;
    setError(null);
    try {
      const next = await request<Detail>(
        `/api/companies/${detail.company.id}/${confirm}`,
        { method: "POST" },
      );
      setConfirm(null);
      onChanged(next);
    } catch (e) {
      setConfirm(null);
      setError(e as ApiError);
    }
  }
  if (editing || isNew)
    return (
      <CompanyForm
        form={form}
        owners={owners}
        setForm={setForm}
        error={error}
        onSave={save}
        onCancel={isNew ? onBack : () => setEditing(false)}
      />
    );
  const c = detail.company;
  return (
    <>
      <header className="page-header">
        <div>
          <button className="button-quiet" onClick={onBack}>
            ← Companies
          </button>
          <p className="eyebrow">Company</p>
          <h1>{c.name}</h1>
          <p className="page-summary">
            {c.description || "No description provided."}
          </p>
        </div>
        <div className="header-actions">
          {canMutate && !c.archivedAt && (
            <button
              className="button-secondary"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          {canMutate && (
            <button
              className="button-danger"
              onClick={() => setConfirm(c.archivedAt ? "restore" : "archive")}
            >
              {c.archivedAt ? "Restore" : "Archive"}
            </button>
          )}
        </div>
      </header>
      {error && <ErrorNotice error={error} />}
      {confirm && (
        <div
          className="confirmation-box"
          role="alertdialog"
          aria-label={`${confirm} company confirmation`}
        >
          <h2>
            {confirm === "archive"
              ? "Archive this company?"
              : "Restore this company?"}
          </h2>
          <p>
            {confirm === "archive"
              ? "It will be hidden from the default list and cannot be edited until restored."
              : "It will become visible in the active company list again."}
          </p>
          <button className="button-secondary" onClick={() => setConfirm(null)}>
            Cancel
          </button>{" "}
          <button
            ref={confirmButton}
            className="button-danger"
            onClick={() => void archive()}
          >
            {confirm}
          </button>
        </div>
      )}
      <div className="detail-grid">
        <section className="surface detail-card">
          <h2>Company information</h2>
          <dl>
            {Object.entries(c)
              .filter(([key]) => !["id", "tags"].includes(key))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{labels[key] ?? key}</dt>
                  <dd>
                    {value == null || value === ""
                      ? "—"
                      : key.endsWith("At")
                        ? new Date(String(value)).toLocaleString()
                        : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
          <p>
            <strong>Tags:</strong> {c.tags.length ? c.tags.join(", ") : "—"}
          </p>
        </section>
        <Related title="Contacts" items={detail.contacts} />
        <Related title="Activities" items={detail.activities} />
        <Related title="Deals" items={detail.deals} />
        <Related title="Tasks" items={detail.tasks} />
        <Related title="History" items={detail.history} safe />
      </div>
    </>
  );
}
function CompanyForm({
  form,
  owners,
  setForm,
  error,
  onSave,
  onCancel,
}: {
  form: Company;
  owners: OwnerOption[];
  setForm: React.Dispatch<React.SetStateAction<Company>>;
  error: ApiError | null;
  onSave: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const ownerOptions =
    form.ownerMembershipId &&
    !owners.some((owner) => owner.id === form.ownerMembershipId)
      ? [
          {
            id: form.ownerMembershipId,
            name: form.ownerName ?? "Current owner",
          },
          ...owners,
        ]
      : owners;
  const field = (key: keyof Company, label: string, type = "text") => (
    <label>
      {label}
      <input
        required={key === "name"}
        type={type}
        value={String(form[key] ?? "")}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Companies</p>
          <h1>{form.id === "new" ? "Create company" : "Edit company"}</h1>
          <p className="page-summary">
            Complete every mutable company field, then save.
          </p>
        </div>
      </header>
      <form className="surface company-form" onSubmit={onSave}>
        {error && <ErrorNotice error={error} />}
        {field("name", "Name")}
        {field("externalReference", "External reference")}
        {field("website", "Website", "url")}
        {field("phone", "Phone")}
        {field("industry", "Industry")}
        {field("size", "Size")}
        {field("address", "Address")}
        <label>
          Owner
          <select
            required
            value={form.ownerMembershipId ?? ""}
            onChange={(e) =>
              setForm({ ...form, ownerMembershipId: e.target.value || null })
            }
          >
            <option value="">Choose an owner</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lifecycle
          <select
            value={form.lifecycleStatus}
            onChange={(e) =>
              setForm({ ...form, lifecycleStatus: e.target.value })
            }
          >
            <option>lead</option>
            <option>prospect</option>
            <option>customer</option>
            <option>former_customer</option>
          </select>
        </label>
        <label>
          Tags
          <input
            value={form.tags.join(", ")}
            onChange={(e) =>
              setForm({
                ...form,
                tags: e.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className="header-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Save company</button>
        </div>
      </form>
    </>
  );
}
function ErrorNotice({ error }: { error: ApiError }) {
  return (
    <div className="inline-error" role="alert">
      <strong>
        {error.status === 403
          ? "You do not have permission to do that."
          : error.code === "VERSION_CONFLICT"
            ? "This company has changed."
            : error.message}
      </strong>
      {error.issues?.length ? (
        <ul>
          {error.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p>
          {error.code === "VERSION_CONFLICT"
            ? "Refresh the company and try again to avoid overwriting another change."
            : ""}
        </p>
      )}
    </div>
  );
}
function Related({
  title,
  items,
  safe = false,
}: {
  title: string;
  items: Record<string, unknown>[];
  safe?: boolean;
}) {
  return (
    <section className="surface detail-card">
      <h2>{title}</h2>
      {items.length ? (
        <ul className="related-list">
          {items.map((item, index) => (
            <li key={String(item.id ?? index)}>
              {safe ? (
                <>
                  <strong>{String(item.action ?? "Company change")}</strong>
                  {item.occurredAt ? (
                    <time dateTime={String(item.occurredAt)}>
                      {new Date(String(item.occurredAt)).toLocaleString()}
                    </time>
                  ) : null}
                  {item.summary && typeof item.summary === "object" ? (
                    <span>
                      {Object.entries(item.summary)
                        .map(
                          ([key, value]) =>
                            `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
                        )
                        .join(" · ")}
                    </span>
                  ) : null}
                </>
              ) : (
                Object.entries(item)
                  .filter(([key]) => key !== "id")
                  .map(([key, value]) => (
                    <span key={key}>
                      <strong>{key}:</strong> {String(value ?? "—")}
                    </span>
                  ))
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-copy">None recorded.</p>
      )}
    </section>
  );
}
