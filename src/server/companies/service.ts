import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SessionIdentity } from "../auth/index.js";
import { currentCorrelationId } from "../request-context.js";

const lifecycle = z.enum(["lead", "prospect", "customer", "former_customer"]);
const optionalText = z.string().trim().max(500).optional().nullable();
const optionalWebsite = z
  .union([z.literal(""), z.url().max(500)])
  .optional()
  .nullable()
  .transform((value) => value || null);
export const companyInput = z.object({
  name: z.string().trim().min(1).max(200),
  externalReference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .nullable()
    .transform((value) => value?.toUpperCase() ?? null),
  website: optionalWebsite,
  phone: optionalText,
  industry: optionalText,
  size: optionalText,
  address: z.string().trim().max(1000).optional().nullable(),
  lifecycleStatus: lifecycle,
  ownerMembershipId: z.string().trim().min(1),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(50))
    .max(30)
    .default([])
    .transform((values) => [...new Set(values)]),
  description: z.string().trim().max(5000).default(""),
  version: z.number().int().positive().optional(),
});

export class CompanyNotFoundError extends Error {}
export class CompanyConflictError extends Error {}
export class CompanyValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Correct the highlighted company fields.");
  }
}
export class CompanyVersionConflictError extends Error {}

export interface CompanyRecord {
  id: string;
  name: string;
  externalReference: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  size: string | null;
  address: string | null;
  lifecycleStatus: z.infer<typeof lifecycle>;
  ownerMembershipId: string | null;
  ownerName: string | null;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
}

const selectCompany = `
  SELECT c.id, c.name, c.external_reference AS externalReference,
    c.website, c.phone, c.industry, c.size, c.address,
    c.lifecycle_status AS lifecycleStatus,
    c.owner_membership_id AS ownerMembershipId,
    u.display_name AS ownerName, c.tags_json AS tagsJson,
    c.description, c.created_at AS createdAt, c.updated_at AS updatedAt,
    c.archived_at AS archivedAt, c.version
  FROM companies c
  LEFT JOIN memberships m ON m.id = c.owner_membership_id AND m.organization_id = c.organization_id
  LEFT JOIN users u ON u.id = m.user_id`;

function mapCompany(row: Record<string, unknown>): CompanyRecord {
  const { tagsJson, ...rest } = row;
  return { ...rest, tags: JSON.parse(String(tagsJson)) } as CompanyRecord;
}

function parseInput(value: unknown) {
  const parsed = companyInput.safeParse(value);
  if (!parsed.success)
    throw new CompanyValidationError(
      parsed.error.issues.map((issue) => issue.message),
    );
  return parsed.data;
}

export class CompanyService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(identity: SessionIdentity, query: URLSearchParams) {
    const page = Math.max(
      1,
      Number.parseInt(query.get("page") ?? "1", 10) || 1,
    );
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(query.get("pageSize") ?? "25", 10) || 25),
    );
    const allowedSort: Record<string, string> = {
      name: "c.name",
      updatedAt: "c.updated_at",
      createdAt: "c.created_at",
      industry: "c.industry",
      size: "c.size",
      lifecycleStatus: "c.lifecycle_status",
    };
    const sort =
      allowedSort[query.get("sort") ?? "updatedAt"] ?? "c.updated_at";
    const direction = query.get("direction") === "asc" ? "ASC" : "DESC";
    const clauses = [
      "c.organization_id = ?",
      "NOT EXISTS (SELECT 1 FROM merge_redirects mr WHERE mr.organization_id=c.organization_id AND mr.entity_type='company' AND mr.source_id=c.id)",
    ];
    const params: unknown[] = [identity.organizationId];
    if (query.get("archived") === "only")
      clauses.push("c.archived_at IS NOT NULL");
    else if (query.get("archived") !== "include")
      clauses.push("c.archived_at IS NULL");
    for (const [parameter, column] of [
      ["lifecycle", "c.lifecycle_status"],
      ["owner", "c.owner_membership_id"],
      ["industry", "c.industry"],
      ["size", "c.size"],
    ] as const) {
      const value = query.get(parameter);
      if (value) {
        clauses.push(`${column} = ?`);
        params.push(value);
      }
    }
    const text = query.get("q")?.trim();
    if (text) {
      clauses.push(
        "(c.name LIKE ? ESCAPE '\\' OR c.external_reference LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')",
      );
      const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
      params.push(pattern, pattern, pattern);
    }
    const tag = query.get("tag")?.trim().toLowerCase();
    if (tag) {
      clauses.push(
        "EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE value = ?)",
      );
      params.push(tag);
    }
    const where = clauses.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM companies c WHERE ${where}`)
        .get(...params) as { count: number }
    ).count;
    const rows = this.db
      .prepare(
        `${selectCompany} WHERE ${where} ORDER BY ${sort} ${direction}, c.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Record<
      string,
      unknown
    >[];
    const owners = this.db
      .prepare(
        `SELECT m.id, u.display_name AS name
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = ? AND m.removed_at IS NULL
         ORDER BY u.display_name, m.id`,
      )
      .all(identity.organizationId);
    const dimensions = this.db
      .prepare(
        "SELECT industry, size, tags_json AS tagsJson FROM companies WHERE organization_id = ?",
      )
      .all(identity.organizationId) as Array<{
      industry: string | null;
      size: string | null;
      tagsJson: string;
    }>;
    return {
      items: rows.map(mapCompany),
      page,
      pageSize,
      total,
      facets: {
        owners,
        industries: [
          ...new Set(
            dimensions.flatMap((row) => (row.industry ? [row.industry] : [])),
          ),
        ].sort(),
        sizes: [
          ...new Set(dimensions.flatMap((row) => (row.size ? [row.size] : []))),
        ].sort(),
        tags: [
          ...new Set(
            dimensions.flatMap((row) => JSON.parse(row.tagsJson) as string[]),
          ),
        ].sort(),
      },
    };
  }

  get(identity: SessionIdentity, id: string) {
    const requestedId = id;
    const redirect = this.db
      .prepare(
        "SELECT target_id AS targetId FROM merge_redirects WHERE organization_id=? AND entity_type='company' AND source_id=?",
      )
      .get(identity.organizationId, id) as { targetId: string } | undefined;
    if (redirect) id = redirect.targetId;
    const row = this.db
      .prepare(`${selectCompany} WHERE c.organization_id = ? AND c.id = ?`)
      .get(identity.organizationId, id) as Record<string, unknown> | undefined;
    if (!row) throw new CompanyNotFoundError("Company not found.");
    const company = mapCompany(row);
    const args = [identity.organizationId, id];
    return {
      company,
      redirect: redirect ? { from: requestedId, to: id } : undefined,
      contacts: this.db
        .prepare(
          "SELECT id, first_name AS firstName, last_name AS lastName, email, status FROM contacts WHERE organization_id = ? AND company_id = ? ORDER BY last_name, first_name",
        )
        .all(...args),
      activities: this.db
        .prepare(
          `SELECT id, type, subject, body, occurred_at AS occurredAt,
            COALESCE(creator_label, 'Former team member') AS creatorLabel,
            company_label AS companyLabel, contact_label AS contactLabel,
            follow_up_task_id AS followUpTaskId
          FROM activities WHERE organization_id = ? AND company_id = ?
          ORDER BY occurred_at DESC, created_at DESC, id DESC`,
        )
        .all(...args),
      deals: this.db
        .prepare(
          "SELECT d.id, d.name, d.amount_minor AS amountMinor, d.currency, d.status, s.name AS stage FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id AND s.organization_id = d.organization_id WHERE d.organization_id = ? AND d.company_id = ? ORDER BY d.updated_at DESC",
        )
        .all(...args),
      tasks: this.db
        .prepare(
          "SELECT id, title, due_at AS dueAt, priority, status FROM tasks WHERE organization_id = ? AND company_id = ? ORDER BY due_at, id",
        )
        .all(...args),
      history: this.db
        .prepare(
          "SELECT id, action, summary_json AS summaryJson, occurred_at AS occurredAt FROM audit_events WHERE organization_id = ? AND entity_type = 'company' AND entity_id = ? ORDER BY occurred_at DESC, id",
        )
        .all(...args)
        .map((entry) => {
          const value = entry as {
            summaryJson: string;
            [key: string]: unknown;
          };
          const { summaryJson, ...fields } = value;
          return { ...fields, summary: JSON.parse(summaryJson) };
        }),
    };
  }

  create(identity: SessionIdentity, value: unknown) {
    const input = parseInput(value);
    this.assertOwner(identity, input.ownerMembershipId);
    const id = `company_${randomUUID()}`;
    const timestamp = this.now().toISOString();
    try {
      this.db
        .transaction(() => {
          this.db
            .prepare(
              `INSERT INTO companies
          (id, organization_id, name, external_reference, website, phone, industry, size, address,
           lifecycle_status, owner_membership_id, tags_json, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              identity.organizationId,
              input.name,
              input.externalReference ?? null,
              input.website ?? null,
              input.phone ?? null,
              input.industry ?? null,
              input.size ?? null,
              input.address ?? null,
              input.lifecycleStatus,
              input.ownerMembershipId ?? null,
              JSON.stringify(input.tags),
              input.description,
              timestamp,
              timestamp,
            );
          this.audit(identity, "company.created", id, { name: input.name });
        })
        .immediate();
    } catch (error) {
      this.rethrowConflict(error);
    }
    return this.get(identity, id);
  }

  update(identity: SessionIdentity, id: string, value: unknown) {
    this.assertNotMerged(identity, id);
    const visible = this.db
      .prepare("SELECT 1 FROM companies WHERE organization_id = ? AND id = ?")
      .get(identity.organizationId, id);
    if (!visible) throw new CompanyNotFoundError("Company not found.");
    const input = parseInput(value);
    if (input.version === undefined)
      throw new CompanyValidationError([
        "Company version is required. Refresh and try again.",
      ]);
    this.assertOwner(identity, input.ownerMembershipId);
    const timestamp = this.now().toISOString();
    try {
      this.db
        .transaction(() => {
          const current = this.db
            .prepare(
              "SELECT version, archived_at AS archivedAt FROM companies WHERE organization_id = ? AND id = ?",
            )
            .get(identity.organizationId, id) as
            { version: number; archivedAt: string | null } | undefined;
          if (!current) throw new CompanyNotFoundError("Company not found.");
          if (current.archivedAt)
            throw new CompanyConflictError(
              "Restore this company before editing it.",
            );
          if (input.version !== current.version)
            throw new CompanyVersionConflictError(
              "This company changed since you opened it. Refresh and try again.",
            );
          this.db
            .prepare(
              `UPDATE companies SET name = ?, external_reference = ?, website = ?, phone = ?,
          industry = ?, size = ?, address = ?, lifecycle_status = ?, owner_membership_id = ?, tags_json = ?,
          description = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ?`,
            )
            .run(
              input.name,
              input.externalReference ?? null,
              input.website ?? null,
              input.phone ?? null,
              input.industry ?? null,
              input.size ?? null,
              input.address ?? null,
              input.lifecycleStatus,
              input.ownerMembershipId ?? null,
              JSON.stringify(input.tags),
              input.description,
              timestamp,
              identity.organizationId,
              id,
            );
          this.audit(identity, "company.updated", id, {
            fromVersion: current.version,
            toVersion: current.version + 1,
          });
        })
        .immediate();
    } catch (error) {
      this.rethrowConflict(error);
    }
    return this.get(identity, id);
  }

  setArchived(identity: SessionIdentity, id: string, archived: boolean) {
    this.assertNotMerged(identity, id);
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            `UPDATE companies SET archived_at = ?, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND id = ? AND archived_at IS ${archived ? "NULL" : "NOT NULL"}`,
          )
          .run(
            archived ? timestamp : null,
            timestamp,
            identity.organizationId,
            id,
          );
        if (result.changes === 0) {
          const exists = this.db
            .prepare(
              "SELECT 1 FROM companies WHERE organization_id = ? AND id = ?",
            )
            .get(identity.organizationId, id);
          if (!exists) throw new CompanyNotFoundError("Company not found.");
          throw new CompanyConflictError(
            archived
              ? "Company is already archived."
              : "Company is already active.",
          );
        }
        this.audit(
          identity,
          archived ? "company.archived" : "company.restored",
          id,
          {},
        );
      })
      .immediate();
    return this.get(identity, id);
  }

  private assertOwner(
    identity: SessionIdentity,
    ownerMembershipId: string | null | undefined,
  ) {
    if (!ownerMembershipId) return;
    const found = this.db
      .prepare(
        "SELECT 1 FROM memberships WHERE id = ? AND organization_id = ? AND removed_at IS NULL",
      )
      .get(ownerMembershipId, identity.organizationId);
    if (!found)
      throw new CompanyValidationError([
        "Choose an active owner in your organization.",
      ]);
  }

  private assertNotMerged(identity: SessionIdentity, id: string) {
    if (
      this.db
        .prepare(
          "SELECT 1 FROM merge_redirects WHERE organization_id=? AND entity_type='company' AND source_id=?",
        )
        .get(identity.organizationId, id)
    )
      throw new CompanyConflictError(
        "This company was merged. Open its surviving record instead.",
      );
  }

  private audit(
    identity: SessionIdentity,
    action: string,
    entityId: string,
    summary: object,
  ) {
    this.db
      .prepare(
        `INSERT INTO audit_events
      (id, organization_id, actor_membership_id, action, entity_type, entity_id, summary_json, occurred_at, correlation_id)
      VALUES (?, ?, ?, ?, 'company', ?, ?, ?, ?)`,
      )
      .run(
        `audit_${randomUUID()}`,
        identity.organizationId,
        identity.membershipId,
        action,
        entityId,
        JSON.stringify(summary),
        this.now().toISOString(),
        currentCorrelationId(),
      );
  }

  private rethrowConflict(error: unknown): never {
    if (
      error instanceof CompanyNotFoundError ||
      error instanceof CompanyConflictError ||
      error instanceof CompanyValidationError ||
      error instanceof CompanyVersionConflictError
    )
      throw error;
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    )
      throw new CompanyConflictError(
        "A company with that external reference already exists.",
      );
    throw error;
  }
}
