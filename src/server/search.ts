import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type SearchActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export type SearchResource = 'companies' | 'contacts' | 'deals' | 'tasks';
export class SearchError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}
const resources = new Set<SearchResource>(['companies', 'contacts', 'deals', 'tasks']);
function term(value: string) {
  return `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`;
}
export class SearchService {
  constructor(
    private readonly db: Database.Database,
    private readonly now = () => new Date().toISOString(),
  ) {}
  search(actor: SearchActor, text: string, limit = 10) {
    const q = text.trim();
    if (!q) return { companies: [], contacts: [], deals: [], tasks: [] };
    const like = term(q),
      max = Math.min(50, Math.max(1, limit));
    return {
      companies: this.db
        .prepare(
          "SELECT id,name,industry,'company' AS type FROM companies WHERE organization_id=? AND archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR coalesce(external_reference,'') LIKE ? ESCAPE '\\') ORDER BY name,id LIMIT ?",
        )
        .all(actor.organizationId, like, like, max),
      contacts: this.db
        .prepare(
          "SELECT id,first_name || ' ' || last_name AS name,email,'contact' AS type FROM contacts WHERE organization_id=? AND archived_at IS NULL AND (first_name || ' ' || last_name LIKE ? ESCAPE '\\' OR coalesce(email,'') LIKE ? ESCAPE '\\') ORDER BY last_name,first_name,id LIMIT ?",
        )
        .all(actor.organizationId, like, like, max),
      deals: this.db
        .prepare(
          "SELECT d.id,d.name,c.name AS company_name,'deal' AS type FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id WHERE d.organization_id=? AND d.archived_at IS NULL AND (d.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY d.name,d.id LIMIT ?",
        )
        .all(actor.organizationId, like, like, max),
      tasks: this.db
        .prepare(
          "SELECT id,title,status,'task' AS type FROM tasks WHERE organization_id=? AND archived_at IS NULL AND title LIKE ? ESCAPE '\\' ORDER BY due_at IS NULL,due_at,id LIMIT ?",
        )
        .all(actor.organizationId, like, max),
    };
  }
  list(
    actor: SearchActor,
    resource: SearchResource,
    query: {
      text?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
      direction?: string;
    } = {},
  ) {
    if (!resources.has(resource))
      throw new SearchError('VALIDATION', 'Choose a valid CRM resource.');
    const page = Math.max(1, query.page ?? 1),
      size = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const table = resource,
      name =
        resource === 'contacts'
          ? "first_name || ' ' || last_name"
          : resource === 'tasks'
            ? 'title'
            : 'name';
    const conditions = ['organization_id=?', 'archived_at IS NULL'];
    const values: unknown[] = [actor.organizationId];
    if (query.text?.trim()) {
      conditions.push(`${name} LIKE ? ESCAPE '\\'`);
      values.push(term(query.text));
    }
    const allowed =
      resource === 'tasks'
        ? ['title', 'due_at', 'updated_at']
        : resource === 'contacts'
          ? ['first_name', 'last_name', 'email', 'updated_at']
          : ['name', 'updated_at', 'created_at'];
    const sort = allowed.includes(query.sort ?? '')
      ? query.sort!
      : resource === 'contacts'
        ? 'last_name'
        : name;
    const direction = query.direction === 'desc' ? 'DESC' : 'ASC',
      where = conditions.join(' AND ');
    const total = (
      this.db.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get(...values) as {
        total: number;
      }
    ).total;
    const items = this.db
      .prepare(
        `SELECT * FROM ${table} WHERE ${where} ORDER BY ${sort} ${direction},id ${direction} LIMIT ? OFFSET ?`,
      )
      .all(...values, size, (page - 1) * size);
    return { items, page, pageSize: size, total, pages: Math.max(1, Math.ceil(total / size)) };
  }
  save(
    actor: SearchActor,
    input: {
      id?: string;
      name: string;
      resource: SearchResource;
      query: unknown;
      version?: number;
    },
  ) {
    if (!resources.has(input.resource) || !input.name.trim() || input.name.trim().length > 120)
      throw new SearchError('VALIDATION', 'Enter a valid saved-view name and resource.');
    const encoded = JSON.stringify(input.query);
    if (encoded.length > 10_000)
      throw new SearchError('VALIDATION', 'Saved view filters are too large.');
    const now = this.now();
    if (!input.id) {
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO saved_views (id,organization_id,membership_id,resource,name,query_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          actor.organizationId,
          actor.membershipId,
          input.resource,
          input.name.trim(),
          encoded,
          now,
          now,
        );
      return this.getView(actor, id);
    }
    const result = this.db
      .prepare(
        'UPDATE saved_views SET name=?,resource=?,query_json=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND membership_id=? AND version=?',
      )
      .run(
        input.name.trim(),
        input.resource,
        encoded,
        now,
        input.id,
        actor.organizationId,
        actor.membershipId,
        input.version,
      );
    if (!result.changes)
      throw new SearchError(
        'CONFLICT',
        'This saved view changed elsewhere. Refresh and try again.',
      );
    return this.getView(actor, input.id);
  }
  getView(actor: SearchActor, id: string) {
    const row = this.db
      .prepare('SELECT * FROM saved_views WHERE id=? AND organization_id=? AND membership_id=?')
      .get(id, actor.organizationId, actor.membershipId) as Record<string, unknown> | undefined;
    if (!row) throw new SearchError('NOT_FOUND', 'Saved view not found.');
    try {
      return { ...row, query: JSON.parse(row.query_json as string) };
    } catch {
      throw new SearchError('VALIDATION', 'This saved view is invalid and cannot be applied.');
    }
  }
  views(actor: SearchActor, resource?: SearchResource) {
    return this.db
      .prepare(
        `SELECT * FROM saved_views WHERE organization_id=? AND membership_id=? ${resource ? 'AND resource=?' : ''} ORDER BY name,id`,
      )
      .all(
        ...(resource
          ? [actor.organizationId, actor.membershipId, resource]
          : [actor.organizationId, actor.membershipId]),
      );
  }
  remove(actor: SearchActor, id: string) {
    const result = this.db
      .prepare('DELETE FROM saved_views WHERE id=? AND organization_id=? AND membership_id=?')
      .run(id, actor.organizationId, actor.membershipId);
    if (!result.changes) throw new SearchError('NOT_FOUND', 'Saved view not found.');
  }
}
