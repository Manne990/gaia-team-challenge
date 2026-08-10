import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AuthService, type SessionIdentity } from "../auth/service.js";

const entityType = z.enum(["company", "contact"]);
const nullable = z.string().trim().max(1000).nullable();
const companyFields = z.object({
  name: z.string().trim().min(1).max(200),
  externalReference: z.string().trim().max(100).nullable(),
  website: z.string().trim().url().max(500).nullable(),
  phone: z.string().trim().max(500).nullable(),
  industry: nullable,
  size: nullable,
  address: nullable,
  lifecycleStatus: z.enum(["lead", "prospect", "customer", "former_customer"]),
  ownerMembershipId: z.string().trim().min(1).nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30),
  description: z.string().trim().max(5000),
});
const contactFields = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).nullable(),
  phone: z.string().trim().max(50).nullable(),
  jobTitle: z.string().trim().max(150).nullable(),
  companyId: z.string().trim().min(1).nullable(),
  ownerMembershipId: z.string().trim().min(1).nullable(),
  status: z.enum(["active", "inactive", "unqualified"]),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  communicationPreference: z.enum(["email", "phone", "none"]),
});
export const mergeInput = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("company"),
    survivorId: z.string().min(1),
    retiredId: z.string().min(1),
    survivorVersion: z.number().int().positive(),
    retiredVersion: z.number().int().positive(),
    fields: companyFields,
  }),
  z.object({
    entityType: z.literal("contact"),
    survivorId: z.string().min(1),
    retiredId: z.string().min(1),
    survivorVersion: z.number().int().positive(),
    retiredVersion: z.number().int().positive(),
    fields: contactFields,
  }),
]);

export class DuplicateNotFoundError extends Error {}
export class DuplicateConflictError extends Error {}

type CandidateRecord = Record<string, unknown> & {
  id: string;
  version: number;
  archivedAt: string | null;
};
export class DuplicateMergeService {
  constructor(
    private db: Database.Database,
    private auth: AuthService,
    private now = () => new Date(),
  ) {}

  candidates(identity: SessionIdentity, rawType: string | undefined) {
    const type = entityType.parse(rawType);
    const records = this.records(identity.organizationId, type);
    const items: Array<{
      entityType: string;
      left: CandidateRecord;
      right: CandidateRecord;
      reasons: Array<{ field: string; normalizedValue: string }>;
    }> = [];
    for (let left = 0; left < records.length; left++)
      for (let right = left + 1; right < records.length; right++) {
        const reasons =
          type === "company"
            ? companyReasons(records[left]!, records[right]!)
            : contactReasons(records[left]!, records[right]!);
        if (reasons.length)
          items.push({
            entityType: type,
            left: records[left]!,
            right: records[right]!,
            reasons,
          });
      }
    return { entityType: type, items };
  }

  merge(identity: SessionIdentity, raw: unknown) {
    this.auth.requireRole(identity, "member");
    const input = mergeInput.parse(raw);
    if (input.survivorId === input.retiredId)
      throw new DuplicateConflictError("Choose two different records.");
    const timestamp = this.now().toISOString();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    let result:
      { survivorId: string; retiredId: string; replayed: boolean } | undefined;
    try {
      this.db
        .transaction(() => {
          const survivorId = this.resolve(
            identity.organizationId,
            input.entityType,
            input.survivorId,
          );
          const existing = this.redirectRow(
            identity.organizationId,
            input.entityType,
            input.retiredId,
          );
          if (existing) {
            if (
              this.resolve(
                identity.organizationId,
                input.entityType,
                existing.targetId,
              ) !== survivorId ||
              existing.requestFingerprint !== fingerprint
            )
              throw new DuplicateConflictError(
                "This merge was already completed with different reviewed values.",
              );
            result = { survivorId, retiredId: input.retiredId, replayed: true };
            return;
          }
          const survivor = this.row(
            identity.organizationId,
            input.entityType,
            survivorId,
          );
          const retired = this.row(
            identity.organizationId,
            input.entityType,
            input.retiredId,
          );
          if (!survivor || !retired) throw new DuplicateNotFoundError();
          if (
            survivor.version !== input.survivorVersion ||
            retired.version !== input.retiredVersion
          )
            throw new DuplicateConflictError(
              "One of these records changed. Review the latest values and try again.",
            );
          this.validateRelations(identity, input);
          if (input.entityType === "company")
            this.mergeCompany(
              identity,
              survivorId,
              input.retiredId,
              input.fields,
              timestamp,
              survivor,
              retired,
            );
          else
            this.mergeContact(
              identity,
              survivorId,
              input.retiredId,
              input.fields,
              timestamp,
              survivor,
              retired,
            );
          this.db
            .prepare(
              "UPDATE merge_redirects SET target_id=? WHERE organization_id=? AND entity_type=? AND target_id=?",
            )
            .run(
              survivorId,
              identity.organizationId,
              input.entityType,
              input.retiredId,
            );
          this.db
            .prepare(
              "INSERT INTO merge_redirects (organization_id,entity_type,source_id,target_id,merged_by_membership_id,merged_at,request_fingerprint) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              identity.organizationId,
              input.entityType,
              input.retiredId,
              survivorId,
              identity.membershipId,
              timestamp,
              fingerprint,
            );
          this.audit(identity, `${input.entityType}.merged`, survivorId, {
            retiredId: input.retiredId,
            survivorVersion: input.survivorVersion,
            retiredVersion: input.retiredVersion,
          });
          result = { survivorId, retiredId: input.retiredId, replayed: false };
        })
        .immediate();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      )
        throw new DuplicateConflictError(
          "The chosen values conflict with another active record.",
        );
      throw error;
    }
    return result!;
  }

  resolveInfo(identity: SessionIdentity, typeRaw: string, id: string) {
    const type = entityType.parse(typeRaw);
    const targetId = this.resolve(identity.organizationId, type, id);
    return {
      entityType: type,
      requestedId: id,
      targetId,
      redirected: targetId !== id,
    };
  }

  private records(org: string, type: "company" | "contact"): CandidateRecord[] {
    if (type === "company")
      return this.db
        .prepare(
          `SELECT id,name,external_reference externalReference,website,phone,industry,size,address,lifecycle_status lifecycleStatus,owner_membership_id ownerMembershipId,tags_json tagsJson,description,archived_at archivedAt,version FROM companies WHERE organization_id=? AND NOT EXISTS (SELECT 1 FROM merge_redirects r WHERE r.organization_id=companies.organization_id AND r.entity_type='company' AND r.source_id=companies.id) ORDER BY id`,
        )
        .all(org)
        .map(parseTags) as CandidateRecord[];
    return this.db
      .prepare(
        `SELECT id,first_name firstName,last_name lastName,email,phone,job_title jobTitle,company_id companyId,owner_membership_id ownerMembershipId,status,tags_json tagsJson,communication_preference communicationPreference,archived_at archivedAt,version FROM contacts WHERE organization_id=? AND NOT EXISTS (SELECT 1 FROM merge_redirects r WHERE r.organization_id=contacts.organization_id AND r.entity_type='contact' AND r.source_id=contacts.id) ORDER BY id`,
      )
      .all(org)
      .map(parseTags) as CandidateRecord[];
  }
  private row(org: string, type: "company" | "contact", id: string) {
    return this.records(org, type).find((row) => row.id === id);
  }
  private redirect(org: string, type: string, id: string) {
    return this.redirectRow(org, type, id)?.targetId;
  }
  private redirectRow(org: string, type: string, id: string) {
    return this.db
      .prepare(
        "SELECT target_id targetId, request_fingerprint requestFingerprint FROM merge_redirects WHERE organization_id=? AND entity_type=? AND source_id=?",
      )
      .get(org, type, id) as
      { targetId: string; requestFingerprint: string | null } | undefined;
  }
  private resolve(org: string, type: string, id: string) {
    const seen = new Set<string>();
    let current = id;
    while (true) {
      if (seen.has(current))
        throw new DuplicateConflictError(
          "The merge redirect chain is invalid.",
        );
      seen.add(current);
      const next = this.redirect(org, type, current);
      if (!next) return current;
      current = next;
    }
  }
  private validateRelations(
    identity: SessionIdentity,
    input: z.infer<typeof mergeInput>,
  ) {
    const owner = input.fields.ownerMembershipId;
    if (
      owner &&
      !this.db
        .prepare(
          "SELECT 1 FROM memberships WHERE organization_id=? AND id=? AND removed_at IS NULL",
        )
        .get(identity.organizationId, owner)
    )
      throw new DuplicateNotFoundError();
    if (
      input.entityType === "contact" &&
      input.fields.companyId &&
      !this.db
        .prepare("SELECT 1 FROM companies WHERE organization_id=? AND id=?")
        .get(identity.organizationId, input.fields.companyId)
    )
      throw new DuplicateNotFoundError();
    if (
      input.entityType === "contact" &&
      input.fields.companyId &&
      this.resolve(
        identity.organizationId,
        "company",
        input.fields.companyId,
      ) !== input.fields.companyId
    )
      throw new DuplicateConflictError(
        "Choose the surviving company instead of a retired identifier.",
      );
  }
  private mergeCompany(
    identity: SessionIdentity,
    survivorId: string,
    retiredId: string,
    fields: z.infer<typeof companyFields>,
    at: string,
    survivor: CandidateRecord,
    retired: CandidateRecord,
  ) {
    this.aliases(
      identity,
      "company",
      survivorId,
      survivorId,
      [
        ["name", survivor.name],
        ["external_reference", survivor.externalReference],
        ["website", survivor.website],
        ["phone", survivor.phone],
      ],
      at,
    );
    this.aliases(
      identity,
      "company",
      survivorId,
      retiredId,
      [
        ["name", retired.name],
        ["external_reference", retired.externalReference],
        ["website", retired.website],
        ["phone", retired.phone],
      ],
      at,
    );
    this.db
      .prepare(
        "UPDATE companies SET external_reference=NULL,archived_at=COALESCE(archived_at,?),updated_at=?,version=version+1 WHERE organization_id=? AND id=?",
      )
      .run(at, at, identity.organizationId, retiredId);
    this.db
      .prepare(
        `UPDATE companies SET name=?,external_reference=?,website=?,phone=?,industry=?,size=?,address=?,lifecycle_status=?,owner_membership_id=?,tags_json=?,description=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=?`,
      )
      .run(
        fields.name,
        clean(fields.externalReference)?.toUpperCase() ?? null,
        clean(fields.website),
        clean(fields.phone),
        clean(fields.industry),
        clean(fields.size),
        clean(fields.address),
        fields.lifecycleStatus,
        fields.ownerMembershipId,
        JSON.stringify(unique(fields.tags)),
        fields.description,
        at,
        identity.organizationId,
        survivorId,
      );
    for (const table of ["contacts", "deals", "activities", "tasks"])
      this.db
        .prepare(
          `UPDATE ${table} SET company_id=? WHERE organization_id=? AND company_id=?`,
        )
        .run(survivorId, identity.organizationId, retiredId);
  }
  private mergeContact(
    identity: SessionIdentity,
    survivorId: string,
    retiredId: string,
    fields: z.infer<typeof contactFields>,
    at: string,
    survivor: CandidateRecord,
    retired: CandidateRecord,
  ) {
    this.aliases(
      identity,
      "contact",
      survivorId,
      survivorId,
      [
        ["name", `${survivor.firstName} ${survivor.lastName}`],
        ["email", survivor.email],
        ["phone", survivor.phone],
      ],
      at,
    );
    this.aliases(
      identity,
      "contact",
      survivorId,
      retiredId,
      [
        ["name", `${retired.firstName} ${retired.lastName}`],
        ["email", retired.email],
        ["phone", retired.phone],
      ],
      at,
    );
    this.db
      .prepare(
        "UPDATE contacts SET archived_at=COALESCE(archived_at,?),updated_at=?,version=version+1 WHERE organization_id=? AND id=?",
      )
      .run(at, at, identity.organizationId, retiredId);
    this.db
      .prepare(
        `UPDATE contacts SET company_id=?,first_name=?,last_name=?,email=?,email_normalized=?,phone=?,job_title=?,owner_membership_id=?,status=?,tags_json=?,communication_preference=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=?`,
      )
      .run(
        fields.companyId,
        fields.firstName,
        fields.lastName,
        clean(fields.email),
        clean(fields.email)?.toLowerCase() ?? null,
        clean(fields.phone),
        clean(fields.jobTitle),
        fields.ownerMembershipId,
        fields.status,
        JSON.stringify(unique(fields.tags)),
        fields.communicationPreference,
        at,
        identity.organizationId,
        survivorId,
      );
    this.db
      .prepare(
        "UPDATE activities SET contact_id=? WHERE organization_id=? AND contact_id=?",
      )
      .run(survivorId, identity.organizationId, retiredId);
    this.db
      .prepare(
        "UPDATE tasks SET contact_id=? WHERE organization_id=? AND contact_id=?",
      )
      .run(survivorId, identity.organizationId, retiredId);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO deal_contacts (organization_id,deal_id,contact_id,created_at) SELECT organization_id,deal_id,?,created_at FROM deal_contacts WHERE organization_id=? AND contact_id=?",
      )
      .run(survivorId, identity.organizationId, retiredId);
    this.db
      .prepare(
        "DELETE FROM deal_contacts WHERE organization_id=? AND contact_id=?",
      )
      .run(identity.organizationId, retiredId);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO activity_participants (organization_id,activity_id,contact_id,contact_label) SELECT organization_id,activity_id,?,contact_label FROM activity_participants WHERE organization_id=? AND contact_id=?",
      )
      .run(survivorId, identity.organizationId, retiredId);
    this.db
      .prepare(
        "DELETE FROM activity_participants WHERE organization_id=? AND contact_id=?",
      )
      .run(identity.organizationId, retiredId);
  }
  private aliases(
    identity: SessionIdentity,
    type: string,
    target: string,
    source: string,
    values: Array<[string, unknown]>,
    at: string,
  ) {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO entity_aliases (id,organization_id,entity_type,entity_id,source_entity_id,kind,value,normalized_value,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const [kind, value] of values) {
      const text = clean(typeof value === "string" ? value : null);
      if (text)
        insert.run(
          `alias_${randomUUID()}`,
          identity.organizationId,
          type,
          target,
          source,
          kind,
          text,
          normalize(text),
          at,
        );
    }
  }
  private audit(
    identity: SessionIdentity,
    action: string,
    id: string,
    summary: object,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,summary_json,occurred_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        `audit_${randomUUID()}`,
        identity.organizationId,
        identity.membershipId,
        action,
        "merge",
        id,
        JSON.stringify(summary),
        this.now().toISOString(),
      );
  }
}
const clean = (value: string | null | undefined) => value?.trim() || null;
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
const phone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : "";
};
function parseTags(row: unknown): CandidateRecord {
  const record = row as Record<string, unknown>;
  const { tagsJson, ...rest } = record;
  return {
    ...rest,
    tags: JSON.parse(String(tagsJson)),
  } as unknown as CandidateRecord;
}
function unique(values: string[]) {
  return [...new Set(values.map((v) => v.trim().toLowerCase()))].sort();
}
function reason(
  field: string,
  left: unknown,
  right: unknown,
  normalizer = (v: unknown) => normalize(String(v ?? "")),
) {
  const a = normalizer(left),
    b = normalizer(right);
  return a && a === b ? { field, normalizedValue: a } : null;
}
function companyReasons(a: CandidateRecord, b: CandidateRecord) {
  return [
    reason("externalReference", a.externalReference, b.externalReference),
    reason("name", a.name, b.name),
    reason("website", a.website, b.website),
    reason("phone", a.phone, b.phone, phone),
  ].filter(Boolean) as Array<{ field: string; normalizedValue: string }>;
}
function contactReasons(a: CandidateRecord, b: CandidateRecord) {
  const sameCompany = a.companyId === b.companyId;
  return [
    reason("email", a.email, b.email),
    reason("phone", a.phone, b.phone, phone),
    sameCompany
      ? reason(
          "name",
          `${a.firstName} ${a.lastName}`,
          `${b.firstName} ${b.lastName}`,
        )
      : null,
  ].filter(Boolean) as Array<{ field: string; normalizedValue: string }>;
}
