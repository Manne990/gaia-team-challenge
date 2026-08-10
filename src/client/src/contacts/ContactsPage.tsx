import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { StatePanel } from "../ui/StatePanel";
import { SavedViewsControl } from "../search/SavedViewsControl";
import { readListState, writeListState } from "../search/urlState";
import "./contacts.css";

export type ContactRole = "owner" | "member" | "viewer";
type ContactStatus = "active" | "inactive" | "unqualified";
type Preference = "email" | "phone" | "none";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  ownerMembershipId?: string | null;
  ownerName?: string | null;
  status: ContactStatus;
  tags: string[];
  communicationPreference: Preference;
  archivedAt?: string | null;
  version: number;
  duplicateWarning?: boolean;
  company?: { id: string; name: string; lifecycleStatus: string } | null;
  activities?: Array<{
    id: string;
    type: string;
    subject: string;
    occurredAt: string;
  }>;
  deals?: Array<{ id: string; name: string; status: string }>;
  tasks?: Array<{ id: string; title: string; status: string }>;
  history?: Array<{ id: string; action: string; occurredAt: string }>;
  [key: string]: unknown;
}

type ListResponse = {
  items: Contact[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyId: string;
  ownerMembershipId: string;
  status: ContactStatus;
  tags: string;
  communicationPreference: Preference;
};
const blankForm: FormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  companyId: "",
  ownerMembershipId: "",
  status: "active",
  tags: "",
  communicationPreference: "email",
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      0,
      "Northstar is temporarily unavailable. Check your connection and try again.",
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.message ?? "Something went wrong. Try again.",
    );
  return body as T;
}

const stateFor = (error: unknown) =>
  error instanceof ApiError && error.status === 403
    ? ("forbidden" as const)
    : ("error" as const);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const toForm = (contact: Contact): FormValues => ({
  firstName: contact.firstName,
  lastName: contact.lastName,
  email: contact.email ?? "",
  phone: contact.phone ?? "",
  jobTitle: contact.jobTitle ?? "",
  companyId: contact.companyId ?? "",
  ownerMembershipId: contact.ownerMembershipId ?? "",
  status: contact.status,
  tags: contact.tags.join(", "),
  communicationPreference: contact.communicationPreference,
});

export function ContactsPage({ role }: { role: ContactRole }) {
  const initial = readListState("contacts");
  const canEdit = role !== "viewer";
  const [list, setList] = useState<ListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Contact | null>(null);
  const [query, setQuery] = useState(initial.q ?? "");
  const [status, setStatus] = useState(initial.status ?? "all");
  const [sort, setSort] = useState(initial.sort ?? "name");
  const [order, setOrder] = useState(initial.order === "desc" ? "desc" : "asc");
  const [includeArchived, setIncludeArchived] = useState(
    initial.includeArchived === "true",
  );
  const [page, setPage] = useState(Math.max(1, Number(initial.page) || 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
      includeArchived: String(includeArchived),
    });
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    params.set("sort", sort);
    params.set("order", order);
    try {
      setList(await request<ListResponse>(`/api/contacts?${params}`));
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, [includeArchived, order, page, query, sort, status]);
  useEffect(() => {
    // Fetching is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    writeListState("contacts", {
      q: query,
      status,
      sort,
      order,
      includeArchived: String(includeArchived),
      page: String(page),
    });
  }, [includeArchived, order, page, query, sort, status]);

  const openContact = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setEditing(false);
    try {
      setDetail(
        (await request<{ contact: Contact }>(`/api/contacts/${id}`)).contact,
      );
    } catch (reason) {
      setDetailError(reason);
    }
  };
  const startCreate = () => {
    setSelectedId("new");
    setDetail(null);
    setSaveError(null);
    setForm(blankForm);
    setEditing(true);
  };
  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setEditing(false);
    setSaveError(null);
  };
  useEffect(() => {
    if (!selectedId) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId]);
  const updateField = (field: keyof FormValues, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    const payload = {
      ...form,
      email: form.email || null,
      phone: form.phone || null,
      jobTitle: form.jobTitle || null,
      companyId: form.companyId || null,
      ownerMembershipId: form.ownerMembershipId || null,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(detail && { version: detail.version }),
    };
    try {
      const result = detail
        ? await request<{ contact: Contact }>(`/api/contacts/${detail.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await request<{ contact: Contact }>("/api/contacts", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      setDetail(result.contact);
      setSelectedId(result.contact.id);
      setEditing(false);
      await load();
    } catch (reason) {
      setSaveError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  const archive = async (archived: boolean) => {
    if (!detail) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await request<{ contact: Contact }>(
        `/api/contacts/${detail.id}/${archived ? "archive" : "restore"}`,
        { method: "POST" },
      );
      setDetail(result.contact);
      await load();
    } catch (reason) {
      setSaveError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="contacts-page" aria-labelledby="contacts-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">Relationships</p>
          <h1 id="contacts-title">Contacts</h1>
          <p className="page-summary">
            Keep every customer relationship useful and up to date.
          </p>
        </div>
        {canEdit && <button onClick={startCreate}>Create contact</button>}
      </header>
      <SavedViewsControl
        resource="contacts"
        state={{
          q: query,
          status,
          sort,
          order,
          includeArchived: String(includeArchived),
          page: String(page),
        }}
        onApply={(next) => {
          setQuery(next.q ?? "");
          setStatus(next.status ?? "all");
          setSort(next.sort ?? "name");
          setOrder(next.order === "desc" ? "desc" : "asc");
          setIncludeArchived(next.includeArchived === "true");
          setPage(Math.max(1, Number(next.page) || 1));
        }}
      />
      <section className="surface contacts-panel">
        <div className="filter-bar" aria-label="Contact filters">
          <label>
            <span className="sr-only">Search contacts</span>
            <input
              type="search"
              value={query}
              placeholder="Search contacts"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Sort
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="name">Name</option>
              <option value="company">Company</option>
              <option value="status">Status</option>
              <option value="updated">Updated</option>
              <option value="created">Created</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setOrder((value) => (value === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
          >
            Direction: {order}
          </button>
          <label>
            <span>Status</span>
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="unqualified">Unqualified</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setSort("name");
              setOrder("asc");
              setIncludeArchived(false);
              setPage(1);
            }}
          >
            Clear filters
          </button>
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                setPage(1);
              }}
            />{" "}
            Include archived
          </label>
        </div>
        {loading && (
          <StatePanel
            kind="loading"
            title="Loading contacts"
            detail="Fetching your contact list…"
          />
        )}
        {!loading && Boolean(error) && (
          <StatePanel
            kind={stateFor(error)}
            title={
              stateFor(error) === "forbidden"
                ? "Contacts are restricted"
                : "Could not load contacts"
            }
            detail={errorText(error)}
            action={
              <button className="button-secondary" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        )}
        {!loading && !error && list && list.items.length === 0 && (
          <StatePanel
            kind="empty"
            title="No contacts found"
            detail="Try changing your filters or create a contact."
            action={
              canEdit ? (
                <button onClick={startCreate}>Create contact</button>
              ) : undefined
            }
          />
        )}
        {!loading && !error && list && list.items.length > 0 && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Contact</th>
                    <th scope="col">Company</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Status</th>
                    <th scope="col">Email</th>
                    <th scope="col">Warning</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((contact) => (
                    <tr key={contact.id}>
                      <th scope="row">
                        <button
                          className="contact-link"
                          onClick={() => void openContact(contact.id)}
                        >
                          {contact.firstName} {contact.lastName}
                        </button>
                      </th>
                      <td>{contact.companyName ?? "—"}</td>
                      <td>{contact.ownerName ?? "—"}</td>
                      <td>
                        <span className="status-badge">{contact.status}</span>
                        {contact.archivedAt && (
                          <small className="archived-label">Archived</small>
                        )}
                      </td>
                      <td>{contact.email ?? "—"}</td>
                      <td>
                        {contact.duplicateWarning && (
                          <span
                            className="duplicate-warning"
                            title="Another active contact has this email"
                          >
                            Duplicate email
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="table-footer">
              <span>
                Showing {(list.page - 1) * list.pageSize + 1}–
                {Math.min(list.page * list.pageSize, list.total)} of{" "}
                {list.total} contacts
              </span>
              <div>
                <button
                  className="button-secondary"
                  disabled={list.page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </button>
                <button
                  className="button-secondary"
                  disabled={list.page >= list.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
      {selectedId && (
        <div
          className="contact-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetail();
          }}
        >
          <section
            className="surface contact-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-detail-title"
          >
            <button
              ref={closeButton}
              className="button-quiet close-detail"
              aria-label="Close contact details"
              onClick={closeDetail}
            >
              ×
            </button>
            {selectedId === "new" ? (
              <ContactForm
                form={form}
                onChange={updateField}
                onSubmit={save}
                saving={saving}
                error={saveError}
                onCancel={closeDetail}
              />
            ) : detailError ? (
              <StatePanel
                kind={stateFor(detailError)}
                title="Could not load contact"
                detail={errorText(detailError)}
                action={
                  <button onClick={() => void openContact(selectedId)}>
                    Try again
                  </button>
                }
              />
            ) : !detail ? (
              <StatePanel kind="loading" title="Loading contact" />
            ) : editing ? (
              <ContactForm
                form={form}
                onChange={updateField}
                onSubmit={save}
                saving={saving}
                error={saveError}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Contact detail</p>
                    <h2 id="contact-detail-title">
                      {detail.firstName} {detail.lastName}
                    </h2>
                    <p>
                      {detail.jobTitle ?? "Contact"} ·{" "}
                      {detail.email ?? "No email"}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      className="button-secondary"
                      onClick={() => {
                        setForm(toForm(detail));
                        setEditing(true);
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
                <dl className="contact-facts">
                  <div>
                    <dt>Company</dt>
                    <dd>
                      {detail.company?.name ??
                        detail.companyName ??
                        detail.companyId ??
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>
                      {detail.ownerName ?? detail.ownerMembershipId ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{detail.status}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{detail.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Communication preference</dt>
                    <dd>{detail.communicationPreference}</dd>
                  </div>
                  {detail.duplicateWarning && (
                    <div className="duplicate-warning">
                      <dt>Warning</dt>
                      <dd>
                        This email is also used by another active contact.
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="contact-related">
                  <RelatedList
                    title="Activities"
                    items={(detail.activities ?? []).map((item) => ({
                      id: item.id,
                      primary: item.subject,
                      secondary: item.type,
                    }))}
                  />
                  <RelatedList
                    title="Deals"
                    items={(detail.deals ?? []).map((item) => ({
                      id: item.id,
                      primary: item.name,
                      secondary: item.status,
                    }))}
                  />
                  <RelatedList
                    title="Tasks"
                    items={(detail.tasks ?? []).map((item) => ({
                      id: item.id,
                      primary: item.title,
                      secondary: item.status,
                    }))}
                  />
                  <RelatedList
                    title="Change history"
                    items={(detail.history ?? []).map((item) => ({
                      id: item.id,
                      primary: item.action,
                      secondary: new Date(item.occurredAt).toLocaleString(),
                    }))}
                  />
                </div>
                {canEdit && (
                  <div className="detail-actions">
                    {detail.archivedAt ? (
                      <button
                        disabled={saving}
                        onClick={() => void archive(false)}
                      >
                        Restore contact
                      </button>
                    ) : (
                      <button
                        className="button-danger"
                        disabled={saving}
                        onClick={() => void archive(true)}
                      >
                        Archive contact
                      </button>
                    )}
                    {saveError && (
                      <p className="form-error" role="alert">
                        {errorText(saveError)}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function RelatedList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; primary: string; secondary: string }>;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.primary}</span>
              <small>{item.secondary}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>None recorded</p>
      )}
    </section>
  );
}

function ContactForm({
  form,
  onChange,
  onSubmit,
  saving,
  error,
  onCancel,
}: {
  form: FormValues;
  onChange: (field: keyof FormValues, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  error: unknown;
  onCancel: () => void;
}) {
  const field = (
    name: keyof FormValues,
    label: string,
    required = false,
    type = "text",
  ) => (
    <label className="contact-field">
      <span>
        {label}
        {required && " *"}
      </span>
      <input
        required={required}
        type={type}
        value={form[name]}
        onChange={(event) => onChange(name, event.target.value)}
      />
    </label>
  );
  return (
    <form className="contact-form" onSubmit={onSubmit}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Contact</p>
          <h2 id="contact-detail-title">
            {form.firstName
              ? `${form.firstName} ${form.lastName}`
              : "Create contact"}
          </h2>
        </div>
      </div>
      {field("firstName", "First name", true)}
      {field("lastName", "Last name", true)}
      {field("email", "Email", false, "email")}
      {field("phone", "Phone")}
      {field("jobTitle", "Job title")}
      {field("companyId", "Company ID")}
      {field("ownerMembershipId", "Owner membership ID")}
      <label className="contact-field">
        <span>Status</span>
        <select
          value={form.status}
          onChange={(event) => onChange("status", event.target.value)}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="unqualified">Unqualified</option>
        </select>
      </label>
      {field("tags", "Tags (comma separated)")}
      <label className="contact-field">
        <span>Communication preference</span>
        <select
          value={form.communicationPreference}
          onChange={(event) =>
            onChange("communicationPreference", event.target.value)
          }
        >
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="none">None</option>
        </select>
      </label>
      {Boolean(error) && (
        <p className="form-error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="detail-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save contact"}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
