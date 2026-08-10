import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AuthService, type SessionIdentity } from "../auth/service.js";

const MAX_BYTES = 512 * 1024;
const MAX_ROWS = 2_000;
const resources = ["companies", "contacts"] as const;
const companyFields = [
  "name",
  "externalReference",
  "website",
  "phone",
  "industry",
  "size",
  "address",
  "lifecycleStatus",
  "tags",
  "description",
] as const;
const contactFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "status",
  "tags",
  "communicationPreference",
] as const;

const previewSchema = z.object({
  resource: z.enum(resources),
  sourceName: z.string().trim().min(1).max(200),
  csv: z.string(),
  mapping: z.record(z.string(), z.string().trim().min(1)),
});

export class ImportValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(" "));
  }
}
export class ImportNotFoundError extends Error {}
export class ImportConflictError extends Error {}

type Resource = (typeof resources)[number];
type RowResult = {
  rowNumber: number;
  status: "valid" | "warning" | "error";
  errors: string[];
  normalized: Record<string, string | string[]>;
};

export class ImportExportService {
  constructor(
    private readonly db: Database.Database,
    private readonly auth: AuthService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  preview(identity: SessionIdentity, raw: unknown) {
    this.auth.requireRole(identity, "member");
    const parsed = previewSchema.safeParse(raw);
    if (!parsed.success)
      throw new ImportValidationError([
        "Provide a resource, source name, CSV, and column mapping.",
      ]);
    const input = parsed.data;
    if (Buffer.byteLength(input.csv, "utf8") > MAX_BYTES)
      throw new ImportValidationError(["CSV files may not exceed 512 KiB."]);
    const records = parseCsv(input.csv);
    if (records.length < 2)
      throw new ImportValidationError([
        "CSV must contain a header and at least one data row.",
      ]);
    if (records.length - 1 > MAX_ROWS)
      throw new ImportValidationError([
        `CSV files may not exceed ${MAX_ROWS} data rows.`,
      ]);
    const headers = records[0]!.map((value) => value.trim());
    if (
      headers.some((header) => !header) ||
      new Set(headers).size !== headers.length
    )
      throw new ImportValidationError([
        "CSV headers must be non-empty and unique.",
      ]);
    const supported =
      input.resource === "companies" ? companyFields : contactFields;
    const unknown = Object.keys(input.mapping).filter(
      (field) => !(supported as readonly string[]).includes(field),
    );
    const missingHeaders = Object.values(input.mapping).filter(
      (header) => !headers.includes(header),
    );
    if (unknown.length || missingHeaders.length)
      throw new ImportValidationError([
        "Mapping contains an unsupported field or missing CSV header.",
      ]);
    const required =
      input.resource === "companies" ? ["name"] : ["firstName", "lastName"];
    if (required.some((field) => !input.mapping[field]))
      throw new ImportValidationError([
        `Map required fields: ${required.join(", ")}.`,
      ]);
    const rows = records
      .slice(1)
      .map((record, index) =>
        this.normalizeRow(
          identity,
          input.resource,
          headers,
          record,
          input.mapping,
          index + 2,
        ),
      );
    const duplicateField =
      input.resource === "companies" ? "externalReference" : "email";
    const seen = new Set<string>();
    for (const row of rows) {
      const value = String(row.normalized[duplicateField] ?? "").toLowerCase();
      if (value && seen.has(value)) {
        row.errors.push(
          `${duplicateField} duplicates another import row (${value}).`,
        );
        row.status = row.status === "valid" ? "warning" : row.status;
      }
      if (value) seen.add(value);
    }
    const summary = summarize(rows);
    const id = `import_${randomUUID()}`;
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO imports (id, organization_id, created_by_membership_id, resource, status, source_name, mapping_json, summary_json, created_at) VALUES (?, ?, ?, ?, 'previewed', ?, ?, ?, ?)`,
          )
          .run(
            id,
            identity.organizationId,
            identity.membershipId,
            input.resource,
            input.sourceName,
            JSON.stringify(input.mapping),
            JSON.stringify(summary),
            timestamp,
          );
        const insert = this.db.prepare(
          `INSERT INTO import_rows (id, import_id, row_number, status, errors_json, normalized_json) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const row of rows)
          insert.run(
            `import_row_${randomUUID()}`,
            id,
            row.rowNumber,
            row.status,
            JSON.stringify(row.errors),
            JSON.stringify(row.normalized),
          );
      })
      .immediate();
    return {
      id,
      resource: input.resource,
      sourceName: input.sourceName,
      status: "previewed",
      summary,
      rows,
    };
  }

  get(identity: SessionIdentity, id: string) {
    const item = this.db
      .prepare(
        `SELECT id, resource, status, source_name AS sourceName, summary_json AS summaryJson, created_at AS createdAt, committed_at AS committedAt FROM imports WHERE organization_id = ? AND id = ?`,
      )
      .get(identity.organizationId, id) as
      | {
          id: string;
          resource: Resource;
          status: string;
          sourceName: string;
          summaryJson: string;
          createdAt: string;
          committedAt: string | null;
        }
      | undefined;
    if (!item) throw new ImportNotFoundError();
    const rows = this.db
      .prepare(
        `SELECT row_number AS rowNumber, status, errors_json AS errorsJson, normalized_json AS normalizedJson FROM import_rows WHERE import_id = ? ORDER BY row_number`,
      )
      .all(id) as Array<{
      rowNumber: number;
      status: RowResult["status"] | "committed";
      errorsJson: string;
      normalizedJson: string;
    }>;
    return {
      ...item,
      summary: JSON.parse(item.summaryJson),
      rows: rows.map(({ errorsJson, normalizedJson, ...row }) => ({
        ...row,
        errors: JSON.parse(errorsJson),
        normalized: JSON.parse(normalizedJson),
      })),
    };
  }

  commit(identity: SessionIdentity, id: string) {
    this.auth.requireRole(identity, "member");
    const preview = this.get(identity, id);
    if (preview.status === "committed") return preview;
    const summary = preview.summary as { errors: number; warnings: number };
    if (summary.errors > 0 || summary.warnings > 0)
      throw new ImportConflictError(
        "Correct every invalid or duplicate-warning row before committing this import.",
      );
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        for (const row of preview.rows)
          this.insertRecord(
            identity,
            preview.resource,
            row.normalized as Record<string, string | string[]>,
            timestamp,
          );
        this.db
          .prepare(
            `UPDATE import_rows SET status = 'committed' WHERE import_id = ?`,
          )
          .run(id);
        this.db
          .prepare(
            `UPDATE imports SET status = 'committed', committed_at = ? WHERE organization_id = ? AND id = ? AND status = 'previewed'`,
          )
          .run(timestamp, identity.organizationId, id);
        this.db
          .prepare(
            `INSERT INTO audit_events (id, organization_id, actor_membership_id, action, entity_type, entity_id, summary_json, occurred_at) VALUES (?, ?, ?, 'import.committed', 'import', ?, ?, ?)`,
          )
          .run(
            `audit_${randomUUID()}`,
            identity.organizationId,
            identity.membershipId,
            id,
            JSON.stringify(preview.summary),
            timestamp,
          );
      })
      .immediate();
    return this.get(identity, id);
  }

  export(
    identity: SessionIdentity,
    resource: Resource,
    query: URLSearchParams,
  ) {
    if (!resources.includes(resource))
      throw new ImportValidationError(["Choose companies or contacts."]);
    const clauses = ["organization_id = ?", "archived_at IS NULL"];
    const values: unknown[] = [identity.organizationId];
    if (resource === "companies") {
      if (query.get("lifecycle") ?? query.get("lifecycleStatus")) {
        clauses.push("lifecycle_status = ?");
        values.push(query.get("lifecycle") ?? query.get("lifecycleStatus"));
      }
      addExactFilter(query, clauses, values, "industry", "industry");
      addExactFilter(query, clauses, values, "size", "size");
      addExactFilter(query, clauses, values, "owner", "owner_membership_id");
      addTagFilter(query, clauses, values);
      if (query.get("q")?.trim()) {
        clauses.push("(name LIKE ? OR external_reference LIKE ?)");
        const q = `%${query.get("q")!.trim()}%`;
        values.push(q, q);
      }
      const rows = this.db
        .prepare(
          `SELECT name, external_reference AS externalReference, website, phone, industry, size, address, lifecycle_status AS lifecycleStatus, tags_json AS tags, description FROM companies WHERE ${clauses.join(" AND ")} ORDER BY name, id`,
        )
        .all(...values) as Record<string, unknown>[];
      return encodeCsv(companyFields, rows);
    }
    if (query.get("status")) {
      clauses.push("status = ?");
      values.push(query.get("status"));
    }
    addExactFilter(query, clauses, values, "company", "company_id");
    addExactFilter(query, clauses, values, "owner", "owner_membership_id");
    addTagFilter(query, clauses, values);
    if (query.get("q")?.trim()) {
      clauses.push("(first_name || ' ' || last_name LIKE ? OR email LIKE ?)");
      const q = `%${query.get("q")!.trim()}%`;
      values.push(q, q);
    }
    const rows = this.db
      .prepare(
        `SELECT first_name AS firstName, last_name AS lastName, email, phone, job_title AS jobTitle, status, tags_json AS tags, communication_preference AS communicationPreference FROM contacts WHERE ${clauses.join(" AND ")} ORDER BY last_name, first_name, id`,
      )
      .all(...values) as Record<string, unknown>[];
    return encodeCsv(contactFields, rows);
  }

  private normalizeRow(
    identity: SessionIdentity,
    resource: Resource,
    headers: string[],
    record: string[],
    mapping: Record<string, string>,
    rowNumber: number,
  ): RowResult {
    const normalized: Record<string, string | string[]> = {};
    const errors: string[] = [];
    for (const [field, header] of Object.entries(mapping)) {
      const value = (record[headers.indexOf(header)] ?? "").trim();
      if (
        /^[=+\-@]/.test(value) &&
        !(field === "phone" && /^\+\d[\d ()-]*$/.test(value))
      )
        errors.push(`${field} begins with a spreadsheet formula marker.`);
      normalized[field] =
        field === "tags"
          ? [
              ...new Set(
                value
                  .split(/[;,]/)
                  .map((tag) => tag.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ]
          : value;
    }
    for (const field of resource === "companies"
      ? ["name"]
      : ["firstName", "lastName"])
      if (!normalized[field]) errors.push(`${field} is required.`);
    if (resource === "companies") {
      const lifecycle = normalized.lifecycleStatus || "lead";
      normalized.lifecycleStatus = String(lifecycle).toLowerCase();
      if (
        !["lead", "prospect", "customer", "former_customer"].includes(
          String(normalized.lifecycleStatus),
        )
      )
        errors.push("lifecycleStatus is invalid.");
      const website = String(normalized.website ?? "");
      if (website) {
        try {
          const url = new URL(website);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch {
          errors.push("website must be an http or https URL.");
        }
      }
      const ref = String(normalized.externalReference ?? "").toUpperCase();
      normalized.externalReference = ref;
      if (
        ref &&
        this.db
          .prepare(
            `SELECT 1 FROM companies WHERE organization_id = ? AND external_reference = ?`,
          )
          .get(identity.organizationId, ref)
      )
        errors.push(
          `externalReference duplicates an existing company (${ref}).`,
        );
    } else {
      normalized.status = String(normalized.status || "active").toLowerCase();
      normalized.communicationPreference = String(
        normalized.communicationPreference || "email",
      ).toLowerCase();
      if (
        !["active", "inactive", "unqualified"].includes(
          String(normalized.status),
        )
      )
        errors.push("status is invalid.");
      if (
        !["email", "phone", "none"].includes(
          String(normalized.communicationPreference),
        )
      )
        errors.push("communicationPreference is invalid.");
      const email = String(normalized.email ?? "").toLowerCase();
      normalized.email = email;
      if (email && !/^\S+@\S+\.\S+$/.test(email))
        errors.push("email is invalid.");
      if (
        email &&
        this.db
          .prepare(
            `SELECT 1 FROM contacts WHERE organization_id = ? AND COALESCE(email_normalized, lower(trim(email))) = ? AND archived_at IS NULL`,
          )
          .get(identity.organizationId, email)
      )
        errors.push(`email may duplicate an existing contact (${email}).`);
    }
    return {
      rowNumber,
      status: errors.length
        ? errors.some(
            (e) => e.includes("duplicates") || e.includes("may duplicate"),
          ) && errors.length === 1
          ? "warning"
          : "error"
        : "valid",
      errors,
      normalized,
    };
  }

  private insertRecord(
    identity: SessionIdentity,
    resource: Resource,
    row: Record<string, string | string[]>,
    timestamp: string,
  ) {
    if (resource === "companies")
      this.db
        .prepare(
          `INSERT INTO companies (id, organization_id, name, external_reference, website, phone, industry, size, address, lifecycle_status, owner_membership_id, tags_json, description, created_at, updated_at) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `company_${randomUUID()}`,
          identity.organizationId,
          row.name,
          row.externalReference ?? "",
          row.website ?? "",
          row.phone ?? "",
          row.industry ?? "",
          row.size ?? "",
          row.address ?? "",
          row.lifecycleStatus,
          identity.membershipId,
          JSON.stringify(row.tags ?? []),
          row.description ?? "",
          timestamp,
          timestamp,
        );
    else
      this.db
        .prepare(
          `INSERT INTO contacts (id, organization_id, first_name, last_name, email, email_normalized, phone, job_title, owner_membership_id, status, tags_json, communication_preference, created_at, updated_at) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `contact_${randomUUID()}`,
          identity.organizationId,
          row.firstName,
          row.lastName,
          row.email ?? "",
          row.email ?? "",
          row.phone ?? "",
          row.jobTitle ?? "",
          identity.membershipId,
          row.status,
          JSON.stringify(row.tags ?? []),
          row.communicationPreference,
          timestamp,
          timestamp,
        );
  }
}

function summarize(rows: RowResult[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    warnings: rows.filter((r) => r.status === "warning").length,
    errors: rows.filter((r) => r.status === "error").length,
  };
}

export function parseCsv(source: string): string[][] {
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted)
    throw new ImportValidationError([
      "CSV contains an unterminated quoted field.",
    ]);
  row.push(cell.replace(/\r$/, ""));
  if (row.some(Boolean) || rows.length === 0) rows.push(row);
  const width = rows[0]?.length ?? 0;
  if (rows.some((item) => item.length !== width))
    throw new ImportValidationError([
      "Every CSV row must contain the same number of columns.",
    ]);
  return rows;
}

function encodeCsv(fields: readonly string[], rows: Record<string, unknown>[]) {
  const escape = (raw: unknown) => {
    let value = raw == null ? "" : String(raw);
    if (
      typeof raw === "string" &&
      (raw.startsWith("[") || raw.startsWith("{"))
    ) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) value = parsed.join(";");
      } catch {
        /* preserve */
      }
    }
    if (/^[=+\-@]/.test(value)) value = `'${value}`;
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  };
  return (
    [
      fields.join(","),
      ...rows.map((row) => fields.map((field) => escape(row[field])).join(",")),
    ].join("\r\n") + "\r\n"
  );
}

function addExactFilter(
  query: URLSearchParams,
  clauses: string[],
  values: unknown[],
  queryName: string,
  column: string,
) {
  const value = query.get(queryName);
  if (value) {
    clauses.push(`${column} = ?`);
    values.push(value);
  }
}

function addTagFilter(
  query: URLSearchParams,
  clauses: string[],
  values: unknown[],
) {
  const tag = query.get("tag")?.trim().toLowerCase();
  if (tag) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)");
    values.push(tag);
  }
}
