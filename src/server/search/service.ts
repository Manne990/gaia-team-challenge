import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { SessionIdentity } from "../auth/index.js";

const resources = ["companies", "contacts", "deals", "tasks"] as const;
type Resource = (typeof resources)[number];
const allowedState: Record<Resource, Set<string>> = {
  companies: new Set([
    "q",
    "lifecycle",
    "owner",
    "industry",
    "size",
    "tag",
    "archived",
    "sort",
    "direction",
    "page",
    "staleBefore",
    "staleThrough",
  ]),
  contacts: new Set([
    "q",
    "companyId",
    "ownerId",
    "status",
    "tag",
    "sort",
    "order",
    "includeArchived",
    "page",
  ]),
  deals: new Set([
    "q",
    "stageId",
    "ownerId",
    "companyId",
    "status",
    "includeArchived",
    "sort",
    "order",
    "page",
    "view",
    "closeFrom",
    "closeTo",
    "outcomeFrom",
    "outcomeTo",
  ]),
  tasks: new Set([
    "q",
    "view",
    "assignee",
    "priority",
    "status",
    "company",
    "contact",
    "deal",
    "archived",
    "sort",
    "direction",
    "page",
    "dueFrom",
    "dueTo",
  ]),
};
const createView = z.object({
  resource: z.enum(resources),
  name: z.string().trim().min(1).max(100),
  state: z.record(z.string(), z.string().max(500)),
});
const updateView = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.record(z.string(), z.string().max(500)),
  version: z.number().int().positive(),
});

export class SearchValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Correct the highlighted search fields.");
  }
}
export class SavedViewNotFoundError extends Error {}
export class SavedViewConflictError extends Error {}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SearchValidationError(
      result.error.issues.map((issue) => issue.message),
    );
  return result.data;
}
function safeState(resource: Resource, state: Record<string, string>) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!allowedState[resource].has(key))
      throw new SearchValidationError([
        `Unsupported ${resource} view field: ${key}.`,
      ]);
    if (value.length > 500)
      throw new SearchValidationError([`View field ${key} is too long.`]);
    result[key] = value;
  }
  return result;
}

export class SearchService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  search(
    identity: SessionIdentity,
    rawQuery: string | undefined,
    rawLimit: string | undefined,
  ) {
    const query = (rawQuery ?? "").trim(),
      limit = Math.min(
        20,
        Math.max(1, Number.parseInt(rawLimit ?? "5", 10) || 5),
      );
    if (query.length < 2) return { query, groups: this.emptyGroups() };
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`,
      org = identity.organizationId;
    const companies = this.db
      .prepare(
        `SELECT id,name title,coalesce(industry,lifecycle_status) context FROM companies WHERE organization_id=? AND archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR external_reference LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE,id LIMIT ?`,
      )
      .all(org, pattern, pattern, limit);
    const contacts = this.db
      .prepare(
        `SELECT ct.id,(ct.first_name||' '||ct.last_name) title,coalesce(c.name,ct.job_title,'No company') context FROM contacts ct LEFT JOIN companies c ON c.id=ct.company_id AND c.organization_id=ct.organization_id WHERE ct.organization_id=? AND ct.archived_at IS NULL AND ((ct.first_name||' '||ct.last_name) LIKE ? ESCAPE '\\' OR ct.email LIKE ? ESCAPE '\\' OR ct.phone LIKE ? ESCAPE '\\') ORDER BY ct.last_name COLLATE NOCASE,ct.first_name COLLATE NOCASE,ct.id LIMIT ?`,
      )
      .all(org, pattern, pattern, pattern, limit);
    const deals = this.db
      .prepare(
        `SELECT d.id,d.name title,(c.name||' · '||s.name) context FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id WHERE d.organization_id=? AND d.archived_at IS NULL AND (d.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY d.name COLLATE NOCASE,d.id LIMIT ?`,
      )
      .all(org, pattern, pattern, limit);
    const tasks = this.db
      .prepare(
        `SELECT t.id,t.title,('Due '||substr(t.due_at,1,10)||' · '||t.status) context FROM tasks t WHERE t.organization_id=? AND t.archived_at IS NULL AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\') ORDER BY t.title COLLATE NOCASE,t.id LIMIT ?`,
      )
      .all(org, pattern, pattern, limit);
    const make = (resource: Resource, label: string, items: unknown[]) => ({
      resource,
      label,
      items: (
        items as Array<{ id: string; title: string; context: string }>
      ).map((item) => ({
        ...item,
        href: `#${resource}?q=${encodeURIComponent(item.title)}`,
      })),
    });
    return {
      query,
      groups: [
        make("companies", "Companies", companies),
        make("contacts", "Contacts", contacts),
        make("deals", "Deals", deals),
        make("tasks", "Tasks", tasks),
      ],
    };
  }

  listViews(identity: SessionIdentity, resourceValue: string | undefined) {
    const resource = z.enum(resources).safeParse(resourceValue);
    if (!resource.success)
      throw new SearchValidationError([
        "Choose a supported saved-view resource.",
      ]);
    const rows = this.db
      .prepare(
        "SELECT id,resource,name,state_json stateJson,created_at createdAt,updated_at updatedAt,version FROM saved_views WHERE organization_id=? AND owner_membership_id=? AND resource=? ORDER BY name COLLATE NOCASE,id",
      )
      .all(
        identity.organizationId,
        identity.membershipId,
        resource.data,
      ) as Array<{
      id: string;
      resource: Resource;
      name: string;
      stateJson: string;
      createdAt: string;
      updatedAt: string;
      version: number;
    }>;
    return {
      items: rows.map(({ stateJson, ...row }) => {
        try {
          const value = JSON.parse(stateJson);
          if (!value || Array.isArray(value) || typeof value !== "object")
            throw new Error();
          return {
            ...row,
            state: safeStoredState(
              row.resource,
              value as Record<string, unknown>,
            ),
          };
        } catch {
          return { ...row, state: {}, invalid: true };
        }
      }),
    };
  }
  createView(identity: SessionIdentity, value: unknown) {
    const input = parsed(createView, value),
      state = safeState(input.resource, input.state),
      timestamp = this.now().toISOString(),
      id = `view_${randomUUID()}`;
    try {
      this.db
        .prepare(
          "INSERT INTO saved_views (id,organization_id,owner_membership_id,resource,name,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          identity.organizationId,
          identity.membershipId,
          input.resource,
          input.name,
          JSON.stringify(state),
          timestamp,
          timestamp,
        );
    } catch (error) {
      this.rethrow(error);
    }
    return this.findView(identity, id);
  }
  updateView(identity: SessionIdentity, id: string, value: unknown) {
    const input = parsed(updateView, value),
      current = this.findView(identity, id),
      state = safeState(current.resource, input.state),
      timestamp = this.now().toISOString();
    try {
      const result = this.db
        .prepare(
          "UPDATE saved_views SET name=?,state_json=?,updated_at=?,version=version+1 WHERE organization_id=? AND owner_membership_id=? AND id=? AND version=?",
        )
        .run(
          input.name,
          JSON.stringify(state),
          timestamp,
          identity.organizationId,
          identity.membershipId,
          id,
          input.version,
        );
      if (!result.changes)
        throw new SavedViewConflictError(
          "This saved view changed. Refresh and try again.",
        );
    } catch (error) {
      this.rethrow(error);
    }
    return this.findView(identity, id);
  }
  deleteView(identity: SessionIdentity, id: string, version: number) {
    const result = this.db
      .prepare(
        "DELETE FROM saved_views WHERE organization_id=? AND owner_membership_id=? AND id=? AND version=?",
      )
      .run(identity.organizationId, identity.membershipId, id, version);
    if (!result.changes) {
      this.findView(identity, id);
      throw new SavedViewConflictError(
        "This saved view changed. Refresh and try again.",
      );
    }
  }
  private findView(identity: SessionIdentity, id: string) {
    const row = this.db
      .prepare(
        "SELECT id,resource,name,state_json stateJson,created_at createdAt,updated_at updatedAt,version FROM saved_views WHERE organization_id=? AND owner_membership_id=? AND id=?",
      )
      .get(identity.organizationId, identity.membershipId, id) as
      | {
          id: string;
          resource: Resource;
          name: string;
          stateJson: string;
          createdAt: string;
          updatedAt: string;
          version: number;
        }
      | undefined;
    if (!row) throw new SavedViewNotFoundError("Saved view not found.");
    return {
      ...row,
      state: JSON.parse(row.stateJson) as Record<string, string>,
    };
  }
  private emptyGroups() {
    return resources.map((resource) => ({
      resource,
      label: resource[0]!.toUpperCase() + resource.slice(1),
      items: [],
    }));
  }
  private rethrow(error: unknown): never {
    if (
      error instanceof SavedViewConflictError ||
      error instanceof SavedViewNotFoundError ||
      error instanceof SearchValidationError
    )
      throw error;
    if (error instanceof Error && error.message.includes("UNIQUE"))
      throw new SavedViewConflictError(
        "A saved view with this name already exists.",
      );
    throw error;
  }
}

function safeStoredState(resource: Resource, value: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value))
    if (
      allowedState[resource].has(key) &&
      typeof item === "string" &&
      item.length <= 500
    )
      result[key] = item;
  return result;
}
