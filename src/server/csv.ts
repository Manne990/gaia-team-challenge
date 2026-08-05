import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ImportResource = 'companies' | 'contacts';
export type ImportRow = {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  values: Record<string, string>;
  errors: string[];
};
const MAX_BYTES = 1_000_000;
const dangerousCell = /^[=+\-@]/;

export function parseCsv(input: string): string[][] {
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES)
    throw new Error('CSV is too large; the limit is 1 MB.');
  if (/\u0000/.test(input)) throw new Error('CSV must be UTF-8 text.');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted && character === '"' && input[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted value.');
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function header(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}
export function previewCsv(resource: ImportResource, input: string): ImportRow[] {
  const [headers, ...rows] = parseCsv(input);
  if (!headers?.length) throw new Error('CSV must include a header row.');
  const keys = headers.map(header);
  return rows.map((cells, index) => {
    const values = Object.fromEntries(
      keys.map((key, column) => [key, (cells[column] ?? '').trim()]),
    );
    const errors: string[] = [];
    if (resource === 'companies' && !values.name) errors.push('Name is required.');
    if (resource === 'contacts') {
      if (!values.first_name) errors.push('First name is required.');
      if (!values.last_name) errors.push('Last name is required.');
      if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
        errors.push('Email must be valid.');
      if (values.email) values.email = values.email.toLowerCase();
    }
    return { rowNumber: index + 2, status: errors.length ? 'error' : 'valid', values, errors };
  });
}
export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (dangerousCell.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function renderCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  return [
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(',')),
  ].join('\r\n');
}

export class CsvImportService {
  constructor(
    private readonly database: Database.Database,
    private readonly now = () => new Date().toISOString(),
  ) {}
  createPreview(
    organizationId: string,
    creatorMembershipId: string,
    resource: ImportResource,
    filename: string,
    input: string,
  ) {
    const rows = previewCsv(resource, input);
    const id = randomUUID();
    const createdAt = this.now();
    this.database.transaction(() => {
      this.database
        .prepare(
          'INSERT INTO imports (id, organization_id, creator_membership_id, resource, filename, status, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          organizationId,
          creatorMembershipId,
          resource,
          filename,
          'preview',
          JSON.stringify({ total: rows.length }),
          createdAt,
        );
      const insert = this.database.prepare(
        'INSERT INTO import_rows (id, organization_id, import_id, row_number, status, errors_json, mapped_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const row of rows)
        insert.run(
          randomUUID(),
          organizationId,
          id,
          row.rowNumber,
          row.status,
          JSON.stringify(row.errors),
          JSON.stringify(row.values),
          createdAt,
        );
    })();
    return { id, rows };
  }
  commit(organizationId: string, importId: string): void {
    const imported = this.database
      .prepare('SELECT resource, status FROM imports WHERE id = ? AND organization_id = ?')
      .get(importId, organizationId) as { resource: ImportResource; status: string } | undefined;
    if (!imported) throw new Error('Import was not found.');
    if (imported.status === 'committed') return;
    const rows = this.database
      .prepare(
        "SELECT mapped_json FROM import_rows WHERE import_id = ? AND organization_id = ? AND status = 'valid'",
      )
      .all(importId, organizationId) as { mapped_json: string }[];
    const now = this.now();
    this.database.transaction(() => {
      for (const item of rows) {
        const value = JSON.parse(item.mapped_json) as Record<string, string>;
        if (imported.resource === 'companies')
          this.database
            .prepare(
              'INSERT INTO companies (id, organization_id, name, external_reference, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(
              randomUUID(),
              organizationId,
              value.name,
              value.external_reference || null,
              now,
              now,
            );
        else
          this.database
            .prepare(
              'INSERT INTO contacts (id, organization_id, first_name, last_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              randomUUID(),
              organizationId,
              value.first_name,
              value.last_name,
              value.email || null,
              now,
              now,
            );
      }
      this.database
        .prepare(
          "UPDATE import_rows SET status = 'committed' WHERE import_id = ? AND organization_id = ? AND status = 'valid'",
        )
        .run(importId, organizationId);
      this.database
        .prepare(
          "UPDATE imports SET status = 'committed', committed_at = ? WHERE id = ? AND organization_id = ?",
        )
        .run(now, importId, organizationId);
    })();
  }
}
