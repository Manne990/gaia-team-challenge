import { FormEvent, useCallback, useEffect, useState } from "react";
import "./governance.css";

type Role = "owner" | "member" | "viewer";
type Organization = {
  id: string;
  name: string;
  slug: string;
  version: number;
  updatedAt: string;
};
type Member = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
};
type AdminResponse = { organization: Organization; members: Member[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error("The network request failed. Try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? "The request could not be completed.");
  return body as T;
}

export function AdministrationPage() {
  const [data, setData] = useState<AdminResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [member, setMember] = useState({
    email: "",
    displayName: "",
    password: "",
    role: "member" as Role,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await request<AdminResponse>("/api/admin/organization");
      setData(result);
      setName(result.organization.name);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load organization.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // Initial data synchronization belongs to the page lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mutate = async (key: string, url: string, init: RequestInit) => {
    setBusy(key);
    setError(null);
    try {
      await request(url, init);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The request could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  };
  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (data && name.trim())
      void mutate("organization", "/api/admin/organization", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          version: data.organization.version,
        }),
      });
  };
  const createMember = (event: FormEvent) => {
    event.preventDefault();
    void mutate("create", "/api/admin/members", {
      method: "POST",
      body: JSON.stringify(member),
    }).then(() =>
      setMember({ email: "", displayName: "", password: "", role: "member" }),
    );
  };
  const changeRole = (userId: string, role: Role) =>
    void mutate(
      `role:${userId}`,
      `/api/admin/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
  const revoke = (person: Member) => {
    if (
      window.confirm(`Revoke access for ${person.displayName || person.email}?`)
    )
      void mutate(
        `revoke:${person.userId}`,
        `/api/admin/members/${encodeURIComponent(person.userId)}`,
        { method: "DELETE" },
      );
  };

  return (
    <section className="governance-page" aria-labelledby="administration-title">
      <header className="governance-header">
        <div>
          <p className="eyebrow">Owner controls</p>
          <h1 id="administration-title">Organization administration</h1>
          <p>Manage organization details and member access.</p>
        </div>
      </header>
      {loading && (
        <div className="governance-state" role="status">
          Loading organization administration…
        </div>
      )}
      {!loading && error && (
        <div className="governance-state governance-error" role="alert">
          <h2>Could not load administration</h2>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!loading && data && (
        <>
          <section
            className="governance-card"
            aria-labelledby="organization-details-title"
          >
            <h2 id="organization-details-title">Organization details</h2>
            <p className="audit-meta">Slug: {data.organization.slug}</p>
            <form className="governance-form" onSubmit={saveName}>
              <label htmlFor="organization-name">
                Name
                <input
                  id="organization-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                disabled={busy === "organization" || !name.trim()}
              >
                {busy === "organization" ? "Saving…" : "Save name"}
              </button>
            </form>
          </section>
          <section
            className="governance-card"
            aria-labelledby="invite-member-title"
          >
            <h2 id="invite-member-title">Add member</h2>
            <form className="governance-form" onSubmit={createMember}>
              <label htmlFor="member-email">
                Email
                <input
                  id="member-email"
                  type="email"
                  value={member.email}
                  onChange={(event) =>
                    setMember({ ...member, email: event.target.value })
                  }
                  required
                />
              </label>
              <label htmlFor="member-display-name">
                Display name
                <input
                  id="member-display-name"
                  value={member.displayName}
                  onChange={(event) =>
                    setMember({ ...member, displayName: event.target.value })
                  }
                  required
                />
              </label>
              <label htmlFor="member-password">
                Temporary password
                <input
                  id="member-password"
                  type="password"
                  minLength={12}
                  value={member.password}
                  onChange={(event) =>
                    setMember({ ...member, password: event.target.value })
                  }
                  required
                />
              </label>
              <label htmlFor="member-role">
                Role
                <select
                  id="member-role"
                  value={member.role}
                  onChange={(event) =>
                    setMember({ ...member, role: event.target.value as Role })
                  }
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
              <button type="submit" disabled={busy === "create"}>
                {busy === "create" ? "Adding…" : "Add member"}
              </button>
            </form>
          </section>
          <section className="governance-card" aria-labelledby="members-title">
            <h2 id="members-title">Members</h2>
            {data.members.length === 0 ? (
              <div className="governance-state">
                <h3>No members yet</h3>
                <p>Add a member above to grant access.</p>
              </div>
            ) : (
              <table className="governance-table">
                <caption className="sr-only">Organization members</caption>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((person) => (
                    <tr key={person.membershipId}>
                      <td>{person.displayName}</td>
                      <td>{person.email}</td>
                      <td>
                        <label>
                          <span className="sr-only">
                            Role for {person.displayName}
                          </span>
                          <select
                            value={person.role}
                            onChange={(event) =>
                              changeRole(
                                person.userId,
                                event.target.value as Role,
                              )
                            }
                            disabled={busy === `role:${person.userId}`}
                          >
                            <option value="owner">Owner</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => revoke(person)}
                          disabled={busy === `revoke:${person.userId}`}
                        >
                          {busy === `revoke:${person.userId}`
                            ? "Revoking…"
                            : "Revoke access"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </section>
  );
}
