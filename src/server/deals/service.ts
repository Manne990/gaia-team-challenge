import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { SessionIdentity } from "../auth/index.js";
import { currentCorrelationId } from "../request-context.js";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
    "Provide a valid date.",
  )
  .nullable()
  .optional();
const dealInput = z.object({
  name: z.string().trim().min(1).max(200),
  companyId: z.string().trim().min(1),
  ownerMembershipId: z.string().trim().min(1),
  stageId: z.string().trim().min(1),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase()),
  probability: z.number().int().min(0).max(100),
  expectedCloseDate: date,
  contactIds: z.array(z.string().trim().min(1)).max(100).default([]),
  version: z.number().int().positive().optional(),
});
const transitionInput = z.object({
  stageId: z.string().trim().min(1),
  lossReason: z.string().trim().min(1).max(1000).nullable().optional(),
  version: z.number().int().positive(),
});
const stageInput = z.object({
  name: z.string().trim().min(1).max(100),
  position: z.number().int().min(0).max(1000),
  kind: z.enum(["open", "won", "lost"]),
  version: z.number().int().positive().optional(),
});

export class DealNotFoundError extends Error {}
export class DealConflictError extends Error {}
export class DealValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Correct the highlighted deal fields.");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new DealValidationError(
      result.error.issues.map((issue) => issue.message),
    );
  return result.data;
}

const selectDeal = `SELECT d.id, d.company_id AS companyId, c.name AS companyName,
 d.owner_membership_id AS ownerMembershipId, u.display_name AS ownerName,
 d.stage_id AS stageId, s.name AS stageName, s.kind AS stageKind,
 d.name, d.amount_minor AS amountMinor, d.currency,
 d.expected_close_date AS expectedCloseDate, d.probability, d.status,
 d.loss_reason AS lossReason, d.archived_at AS archivedAt,
 d.created_at AS createdAt, d.updated_at AS updatedAt, d.version
 FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id
 JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id
 JOIN memberships m ON m.id=d.owner_membership_id AND m.organization_id=d.organization_id
 JOIN users u ON u.id=m.user_id`;

export class DealsService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  stages(identity: SessionIdentity, includeInactive = false) {
    return this.db
      .prepare(
        `SELECT id,name,position,kind,active,version FROM pipeline_stages
      WHERE organization_id=? ${includeInactive ? "" : "AND active=1"} ORDER BY position,id`,
      )
      .all(identity.organizationId);
  }

  list(identity: SessionIdentity, query: URLSearchParams) {
    const page = Math.max(
      1,
      Number.parseInt(query.get("page") ?? "1", 10) || 1,
    );
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(query.get("pageSize") ?? "25", 10) || 25),
    );
    const clauses = ["d.organization_id=?"],
      params: unknown[] = [identity.organizationId];
    if (query.get("includeArchived") !== "true")
      clauses.push("d.archived_at IS NULL");
    for (const [key, column] of [
      ["stageId", "d.stage_id"],
      ["ownerId", "d.owner_membership_id"],
      ["companyId", "d.company_id"],
      ["status", "d.status"],
    ] as const) {
      const value = query.get(key);
      if (value) {
        clauses.push(`${column}=?`);
        params.push(value);
      }
    }
    const closeFrom = query.get("closeFrom");
    if (closeFrom) {
      clauses.push("d.expected_close_date>=?");
      params.push(closeFrom);
    }
    const closeTo = query.get("closeTo");
    if (closeTo) {
      clauses.push("d.expected_close_date<?");
      params.push(closeTo);
    }
    const outcomeAt = `coalesce((SELECT max(h.changed_at) FROM deal_stage_history h
      JOIN pipeline_stages hs ON hs.id=h.to_stage_id AND hs.organization_id=h.organization_id
      WHERE h.organization_id=d.organization_id AND h.deal_id=d.id AND hs.kind=d.status),d.updated_at)`;
    const outcomeFrom = query.get("outcomeFrom");
    if (outcomeFrom) {
      clauses.push(`${outcomeAt}>=?`);
      params.push(outcomeFrom);
    }
    const outcomeTo = query.get("outcomeTo");
    if (outcomeTo) {
      clauses.push(`${outcomeAt}<?`);
      params.push(outcomeTo);
    }
    const q = query.get("q")?.trim();
    if (q) {
      clauses.push("(d.name LIKE ? OR c.name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    const where = clauses.join(" AND ");
    const total = (
      this.db
        .prepare(
          `SELECT count(*) count FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id WHERE ${where}`,
        )
        .get(...params) as { count: number }
    ).count;
    const sorts: Record<string, string> = {
      name: "d.name",
      amount: "d.amount_minor",
      close: "d.expected_close_date",
      updated: "d.updated_at",
      stage: "s.position",
    };
    const sort = sorts[query.get("sort") ?? "updated"] ?? sorts.updated;
    const order = query.get("order") === "asc" ? "ASC" : "DESC";
    const rows = this.db
      .prepare(
        `${selectDeal} WHERE ${where} ORDER BY ${sort} ${order},d.id LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Array<
      Record<string, unknown>
    >;
    const items = rows.map((row) =>
      this.withContacts(identity.organizationId, row),
    );
    const aggregateRows = this.db
      .prepare(
        `SELECT d.currency, d.amount_minor AS amountMinor FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id WHERE ${where}`,
      )
      .all(...params) as Array<{ currency: string; amountMinor: number }>;
    const exactTotals = new Map<string, bigint>();
    for (const row of aggregateRows)
      exactTotals.set(
        row.currency,
        (exactTotals.get(row.currency) ?? 0n) + BigInt(row.amountMinor),
      );
    const byCurrency = [...exactTotals]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amountMinor]) => ({
        currency,
        amountMinor: amountMinor.toString(),
      }));
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totals: {
        amountMinor:
          byCurrency.length === 1 ? byCurrency[0]!.amountMinor : null,
        currency: byCurrency.length === 1 ? byCurrency[0]!.currency : null,
        byCurrency,
      },
      stages: this.stages(identity),
    };
  }

  get(identity: SessionIdentity, id: string) {
    const row = this.find(identity, id);
    const deal = this.withContacts(identity.organizationId, row);
    const args = [identity.organizationId, id];
    return {
      deal: {
        ...deal,
        contacts: this.db
          .prepare(
            "SELECT c.id,c.first_name firstName,c.last_name lastName,c.email FROM contacts c JOIN deal_contacts dc ON dc.contact_id=c.id AND dc.organization_id=c.organization_id WHERE dc.organization_id=? AND dc.deal_id=? ORDER BY c.last_name,c.first_name",
          )
          .all(...args),
        stageHistory: this.db
          .prepare(
            "SELECT h.id,h.from_stage_id fromStageId,fs.name fromStageName,h.to_stage_id toStageId,ts.name toStageName,h.changed_at changedAt FROM deal_stage_history h LEFT JOIN pipeline_stages fs ON fs.id=h.from_stage_id AND fs.organization_id=h.organization_id JOIN pipeline_stages ts ON ts.id=h.to_stage_id AND ts.organization_id=h.organization_id WHERE h.organization_id=? AND h.deal_id=? ORDER BY h.changed_at DESC,h.id DESC",
          )
          .all(...args),
        auditHistory: this.db
          .prepare(
            "SELECT id,action,summary_json summaryJson,occurred_at occurredAt FROM audit_events WHERE organization_id=? AND entity_type='deal' AND entity_id=? ORDER BY occurred_at DESC,id DESC",
          )
          .all(...args)
          .map((entry) => {
            const { summaryJson, ...rest } = entry as {
              summaryJson: string;
              [key: string]: unknown;
            };
            return { ...rest, summary: JSON.parse(summaryJson) };
          }),
      },
    };
  }

  create(identity: SessionIdentity, value: unknown) {
    const input = parse(dealInput, value);
    this.validateRelations(identity, input, true);
    const stage = this.stage(identity, input.stageId, true);
    if (stage.kind !== "open")
      throw new DealValidationError([
        "Create deals in an open stage, then record the outcome as a transition.",
      ]);
    const id = `deal_${randomUUID()}`,
      timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO deals (id,organization_id,company_id,owner_membership_id,stage_id,name,amount_minor,currency,expected_close_date,probability,status,loss_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'open',NULL,?,?)`,
          )
          .run(
            id,
            identity.organizationId,
            input.companyId,
            input.ownerMembershipId,
            input.stageId,
            input.name,
            input.amountMinor,
            input.currency,
            input.expectedCloseDate ?? null,
            input.probability,
            timestamp,
            timestamp,
          );
        this.replaceContacts(identity, id, input.contactIds, timestamp);
        this.history(identity, id, null, input.stageId, timestamp);
        this.audit(identity, "deal.created", id, { stageId: input.stageId });
      })
      .immediate();
    return this.get(identity, id);
  }

  update(identity: SessionIdentity, id: string, value: unknown) {
    const input = parse(dealInput, value);
    if (!input.version)
      throw new DealValidationError(["Deal version is required."]);
    this.validateRelations(identity, input, false);
    const current = this.find(identity, id) as Record<string, unknown>;
    if (current.archivedAt)
      throw new DealConflictError("Restore this deal before editing it.");
    if (current.version !== input.version)
      throw new DealConflictError(
        "This deal changed since you opened it. Refresh and try again.",
      );
    if (current.stageId !== input.stageId)
      throw new DealValidationError([
        "Use the stage transition action to change stages.",
      ]);
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            `UPDATE deals SET company_id=?,owner_membership_id=?,name=?,amount_minor=?,currency=?,expected_close_date=?,probability=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?`,
          )
          .run(
            input.companyId,
            input.ownerMembershipId,
            input.name,
            input.amountMinor,
            input.currency,
            input.expectedCloseDate ?? null,
            input.probability,
            timestamp,
            identity.organizationId,
            id,
            input.version,
          );
        if (!result.changes)
          throw new DealConflictError(
            "This deal changed since you opened it. Refresh and try again.",
          );
        this.replaceContacts(identity, id, input.contactIds, timestamp);
        this.audit(identity, "deal.updated", id, {
          fromVersion: input.version,
        });
      })
      .immediate();
    return this.get(identity, id);
  }

  transition(identity: SessionIdentity, id: string, value: unknown) {
    const input = parse(transitionInput, value),
      current = this.find(identity, id) as Record<string, unknown>;
    const stage = this.stage(identity, input.stageId, true);
    if (current.archivedAt)
      throw new DealConflictError(
        "Restore this deal before changing its stage.",
      );
    if (current.version !== input.version)
      throw new DealConflictError(
        "This deal changed since you opened it. Refresh and try again.",
      );
    if (current.stageId === input.stageId)
      throw new DealValidationError(["Choose a different stage."]);
    if (stage.kind === "lost" && !input.lossReason)
      throw new DealValidationError(["A loss reason is required."]);
    if (stage.kind !== "lost" && input.lossReason)
      throw new DealValidationError([
        "Loss reason is only valid for a lost outcome.",
      ]);
    const timestamp = this.now().toISOString(),
      status = stage.kind,
      probability =
        stage.kind === "won"
          ? 100
          : stage.kind === "lost"
            ? 0
            : current.probability;
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            "UPDATE deals SET stage_id=?,status=?,loss_reason=?,probability=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?",
          )
          .run(
            input.stageId,
            status,
            input.lossReason ?? null,
            probability,
            timestamp,
            identity.organizationId,
            id,
            input.version,
          );
        if (!result.changes)
          throw new DealConflictError(
            "This deal changed since you opened it. Refresh and try again.",
          );
        this.history(
          identity,
          id,
          String(current.stageId),
          input.stageId,
          timestamp,
        );
        this.audit(identity, "deal.transitioned", id, {
          fromStageId: current.stageId,
          toStageId: input.stageId,
          toStageName: stage.name,
          status,
          recipientMembershipId: current.ownerMembershipId,
        });
      })
      .immediate();
    return this.get(identity, id);
  }

  setArchived(identity: SessionIdentity, id: string, archived: boolean) {
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            `UPDATE deals SET archived_at=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND archived_at IS ${archived ? "NULL" : "NOT NULL"}`,
          )
          .run(
            archived ? timestamp : null,
            timestamp,
            identity.organizationId,
            id,
          );
        if (!result.changes) {
          this.find(identity, id);
          throw new DealConflictError(
            archived ? "Deal is already archived." : "Deal is already active.",
          );
        }
        this.audit(
          identity,
          archived ? "deal.archived" : "deal.restored",
          id,
          {},
        );
      })
      .immediate();
    return this.get(identity, id);
  }

  createStage(identity: SessionIdentity, value: unknown) {
    const input = parse(stageInput, value),
      timestamp = this.now().toISOString(),
      id = `stage_${randomUUID()}`;
    this.db
      .transaction(() => {
        this.assertStageNameAvailable(identity.organizationId, input.name);
        this.makePosition(identity.organizationId, input.position);
        this.db
          .prepare(
            "INSERT INTO pipeline_stages (id,organization_id,name,position,kind,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)",
          )
          .run(
            id,
            identity.organizationId,
            input.name,
            input.position,
            input.kind,
            timestamp,
            timestamp,
          );
        this.audit(
          identity,
          "pipeline_stage.created",
          id,
          {
            name: input.name,
            kind: input.kind,
          },
          "pipeline_stage",
        );
      })
      .immediate();
    return this.stage(identity, id, false);
  }
  updateStage(identity: SessionIdentity, id: string, value: unknown) {
    const input = parse(stageInput, value);
    if (!input.version)
      throw new DealValidationError(["Stage version is required."]);
    const current = this.stage(identity, id, false);
    if (current.version !== input.version)
      throw new DealConflictError("This stage changed since you opened it.");
    this.assertStageNameAvailable(identity.organizationId, input.name, id);
    if (current.kind !== input.kind) {
      const used = this.db
        .prepare(
          "SELECT 1 FROM deals WHERE organization_id=? AND stage_id=? LIMIT 1",
        )
        .get(identity.organizationId, id);
      if (used)
        throw new DealConflictError(
          "A stage with deal history cannot change outcome type.",
        );
    }
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        if (current.position !== input.position)
          this.makePosition(identity.organizationId, input.position, id);
        this.db
          .prepare(
            "UPDATE pipeline_stages SET name=?,position=?,kind=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?",
          )
          .run(
            input.name,
            input.position,
            input.kind,
            timestamp,
            identity.organizationId,
            id,
            input.version,
          );
        this.audit(
          identity,
          "pipeline_stage.updated",
          id,
          {
            kind: input.kind,
          },
          "pipeline_stage",
        );
      })
      .immediate();
    return this.stage(identity, id, false);
  }
  deactivateStage(identity: SessionIdentity, id: string) {
    const current = this.stage(identity, id, false);
    if (!current.active)
      throw new DealConflictError("Stage is already inactive.");
    const sameKind = (
      this.db
        .prepare(
          "SELECT count(*) count FROM pipeline_stages WHERE organization_id=? AND kind=? AND active=1",
        )
        .get(identity.organizationId, current.kind) as { count: number }
    ).count;
    if (sameKind <= 1)
      throw new DealConflictError(
        `Keep at least one active ${current.kind} stage.`,
      );
    this.db
      .prepare(
        "UPDATE pipeline_stages SET active=0,updated_at=?,version=version+1 WHERE organization_id=? AND id=?",
      )
      .run(this.now().toISOString(), identity.organizationId, id);
    this.audit(
      identity,
      "pipeline_stage.deactivated",
      id,
      {},
      "pipeline_stage",
    );
    return this.stage(identity, id, false);
  }

  private find(identity: SessionIdentity, id: string) {
    const row = this.db
      .prepare(`${selectDeal} WHERE d.organization_id=? AND d.id=?`)
      .get(identity.organizationId, id) as Record<string, unknown> | undefined;
    if (!row) throw new DealNotFoundError("Deal not found.");
    return row;
  }
  private stage(identity: SessionIdentity, id: string, activeOnly: boolean) {
    const row = this.db
      .prepare(
        `SELECT id,name,position,kind,active,version FROM pipeline_stages WHERE organization_id=? AND id=? ${activeOnly ? "AND active=1" : ""}`,
      )
      .get(identity.organizationId, id) as
      | {
          id: string;
          name: string;
          position: number;
          kind: "open" | "won" | "lost";
          active: number;
          version: number;
        }
      | undefined;
    if (!row)
      throw new DealValidationError([
        "Choose an active pipeline stage in your organization.",
      ]);
    return row;
  }
  private validateRelations(
    identity: SessionIdentity,
    input: z.infer<typeof dealInput>,
    requireActiveStage: boolean,
  ) {
    for (const [id, sql, message] of [
      [
        input.companyId,
        "SELECT 1 FROM companies WHERE organization_id=? AND id=? AND archived_at IS NULL",
        "Choose an active company in your organization.",
      ],
      [
        input.ownerMembershipId,
        "SELECT 1 FROM memberships WHERE organization_id=? AND id=? AND removed_at IS NULL",
        "Choose an active owner in your organization.",
      ],
    ] as const)
      if (!this.db.prepare(sql).get(identity.organizationId, id))
        throw new DealValidationError([message]);
    this.stage(identity, input.stageId, requireActiveStage);
    const unique = [...new Set(input.contactIds)];
    if (unique.length !== input.contactIds.length)
      throw new DealValidationError(["Contact relationships must be unique."]);
    for (const id of unique)
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM contacts WHERE organization_id=? AND id=? AND archived_at IS NULL",
          )
          .get(identity.organizationId, id)
      )
        throw new DealValidationError([
          "Choose active contacts in your organization.",
        ]);
  }
  private withContacts(org: string, row: Record<string, unknown>) {
    return {
      ...row,
      contactIds: (
        this.db
          .prepare(
            "SELECT contact_id id FROM deal_contacts WHERE organization_id=? AND deal_id=? ORDER BY contact_id",
          )
          .all(org, row.id) as Array<{ id: string }>
      ).map(({ id }) => id),
    };
  }
  private replaceContacts(
    identity: SessionIdentity,
    id: string,
    contactIds: string[],
    timestamp: string,
  ) {
    this.db
      .prepare(
        "DELETE FROM deal_contacts WHERE organization_id=? AND deal_id=?",
      )
      .run(identity.organizationId, id);
    const insert = this.db.prepare(
      "INSERT INTO deal_contacts (organization_id,deal_id,contact_id,created_at) VALUES (?,?,?,?)",
    );
    for (const contactId of [...new Set(contactIds)])
      insert.run(identity.organizationId, id, contactId, timestamp);
  }
  private history(
    identity: SessionIdentity,
    id: string,
    from: string | null,
    to: string,
    timestamp: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO deal_stage_history (id,organization_id,deal_id,from_stage_id,to_stage_id,changed_by_membership_id,changed_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        `history_${randomUUID()}`,
        identity.organizationId,
        id,
        from,
        to,
        identity.membershipId,
        timestamp,
      );
  }
  private audit(
    identity: SessionIdentity,
    action: string,
    id: string,
    summary: object,
    entityType = "deal",
  ) {
    this.db
      .prepare(
        "INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,summary_json,occurred_at,correlation_id) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `audit_${randomUUID()}`,
        identity.organizationId,
        identity.membershipId,
        action,
        entityType,
        id,
        JSON.stringify(summary),
        this.now().toISOString(),
        currentCorrelationId(),
      );
  }
  private makePosition(org: string, position: number, exclude?: string) {
    const occupied = this.db
      .prepare(
        "SELECT id FROM pipeline_stages WHERE organization_id=? AND position=? AND (? IS NULL OR id<>?)",
      )
      .get(org, position, exclude ?? null, exclude ?? null);
    if (occupied)
      throw new DealConflictError("Another stage already uses that position.");
  }
  private assertStageNameAvailable(
    org: string,
    name: string,
    exclude?: string,
  ) {
    const found = this.db
      .prepare(
        "SELECT 1 FROM pipeline_stages WHERE organization_id=? AND name=? COLLATE NOCASE AND (? IS NULL OR id<>?)",
      )
      .get(org, name, exclude ?? null, exclude ?? null);
    if (found)
      throw new DealConflictError("Another stage already uses that name.");
  }
}
