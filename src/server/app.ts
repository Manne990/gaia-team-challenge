import express, { type ErrorRequestHandler } from 'express';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../shared/config.js';

const require = createRequire(import.meta.url);
const { parseCsv, escapeCsv, normalizeTags } = require('../imports/csv.mjs') as {
  parseCsv(source: string): { headers: string[]; rows: string[][] };
  escapeCsv(value: unknown): string;
  normalizeTags(value: unknown): string[];
};
const { openDatabase, migrate } = require('../db/database.mjs') as {
  openDatabase(path: string): any;
  migrate(database: any): void;
};
const { createAuthService, AuthError } = require('../auth/service.mjs') as {
  createAuthService(database: unknown): any;
  AuthError: new (...args: any[]) => Error & { code: string };
};
const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().optional(),
});
const companyInput = z.object({
  name: z.string().trim().min(1).max(200),
  externalReference: z.string().trim().max(100).optional(),
  website: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(60).optional(),
  industry: z.string().trim().max(100).optional(),
  size: z.string().trim().max(60).optional(),
  address: z.string().trim().max(500).optional(),
  lifecycleStatus: z.enum(['lead', 'prospect', 'customer', 'inactive']).default('lead'),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  description: z.string().max(5000).default(''),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
});
const companyUpdate = companyInput.extend({ version: z.coerce.number().int().positive() });
const companyListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  text: z.string().trim().optional(),
  lifecycle: z.enum(['lead', 'prospect', 'customer', 'inactive']).optional(),
  ownerId: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1).optional(),
  size: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sort: z.enum(['name', 'createdAt', 'updatedAt', 'lifecycle']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});
const dealInput = z.object({
  name: z.string().trim().min(1).max(240),
  companyId: z.string().min(1),
  ownerId: z.string().min(1).nullable().optional(),
  stageId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  expectedCloseDate: z.string().date().nullable().optional(),
  probability: z.number().int().min(0).max(100).default(0),
  lossReason: z.string().trim().max(500).nullable().optional(),
  contactIds: z.array(z.string().min(1)).max(50).default([]),
});
const dealUpdate = dealInput
  .omit({ stageId: true, contactIds: true })
  .extend({ version: z.number().int().positive() });
const contactInput = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320).optional().or(z.literal('')),
  phone: z.string().trim().max(80).optional().default(''),
  jobTitle: z.string().trim().max(160).optional().default(''),
  companyId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  status: z.enum(['active', 'inactive', 'lead']).optional().default('active'),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]),
  communicationPreference: z.enum(['email', 'phone', 'none']).optional().default('email'),
  version: z.number().int().positive().optional(),
});
const contactUpdateInput = contactInput.extend({ version: z.number().int().positive() });
const contactFields = `id, first_name AS firstName, last_name AS lastName, email, phone, job_title AS jobTitle, company_id AS companyId, owner_id AS ownerId, status, tags_json AS tagsJson, communication_preference AS communicationPreference, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt, version`;
const activityTypes = ['call', 'email', 'meeting', 'note', 'status_change'] as const;
const activityInput = z.object({
  type: z.enum(activityTypes),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().max(10_000).default(''),
  occurredAt: z.string().datetime({ offset: true }),
  participantNames: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  companyId: z.string().trim().min(1).max(100).nullable().optional(),
  contactId: z.string().trim().min(1).max(100).nullable().optional(),
  dealId: z.string().trim().min(1).max(100).nullable().optional(),
  followUp: z
    .object({
      title: z.string().trim().min(1).max(300),
      description: z.string().trim().max(10_000).default(''),
      dueAt: z.string().datetime({ offset: true }).nullable().optional(),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
      assigneeId: z.string().trim().min(1).max(100).nullable().optional(),
    })
    .optional(),
});
const activityUpdateInput = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().max(10_000),
  participantNames: z.array(z.string().trim().min(1).max(160)).max(50),
  version: z.coerce.number().int().positive(),
});
const activityListQuery = z
  .object({
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    type: z.enum(activityTypes).optional(),
    authorId: z.string().trim().min(1).max(100).optional(),
    relatedRecordId: z.string().trim().min(1).max(100).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursorOccurredAt: z.string().datetime({ offset: true }).optional(),
    cursorId: z.string().trim().min(1).max(100).optional(),
    snapshotCreatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((query) => Boolean(query.cursorOccurredAt) === Boolean(query.cursorId), {
    message: 'A timeline cursor needs both its occurrence time and identifier.',
  });
const importPreviewInput = z.object({
  resource: z.enum(['companies', 'contacts']),
  csv: z.string().max(1_000_000),
  mapping: z.record(z.string(), z.string()).optional(),
});
const taskInput = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(5000).optional().default(''),
  assigneeId: z.string().trim().min(1).max(100).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().default('open'),
  companyId: z.string().trim().min(1).max(100).nullable().optional(),
  contactId: z.string().trim().min(1).max(100).nullable().optional(),
  dealId: z.string().trim().min(1).max(100).nullable().optional(),
});
const taskUpdateInput = taskInput.extend({ version: z.coerce.number().int().positive() });
const taskListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  text: z.string().trim().max(200).optional(),
  assigneeId: z.string().trim().optional(),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
  relation: z.enum(['company', 'contact', 'deal']).optional(),
  relationId: z.string().trim().optional(),
  due: z.enum(['overdue', 'today', 'upcoming', 'completed']).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sort: z.enum(['dueAt', 'createdAt', 'updatedAt', 'priority']).default('dueAt'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});
const dealListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  text: z.string().trim().max(200).optional(),
  companyId: z.string().trim().min(1).optional(),
  ownerId: z.string().trim().min(1).optional(),
  stageId: z.string().trim().min(1).optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sort: z
    .enum(['name', 'amount', 'createdAt', 'updatedAt', 'expectedCloseDate'])
    .default('updatedAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
const savedViewInput = z.object({
  resource: z.enum(['companies', 'contacts', 'deals', 'tasks']),
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.unknown()).refine((filters) => Object.keys(filters).length <= 30),
});
const cookieToken = (cookie = '') =>
  cookie
    .split(';')
    .map((item) => item.trim().split('='))
    .find(([name]) => name === 'northstar_session')?.[1];

export function createApp(config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  const database = openDatabase(config.databasePath);
  migrate(database);
  const auth = createAuthService(database);
  const transaction = <T>(work: () => T): T => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  const activityFields = `
    id, type, subject, body, occurred_at AS occurredAt, creator_id AS creatorId,
    creator_name_snapshot AS creatorName, company_id AS companyId,
    contact_id AS contactId, deal_id AS dealId, task_id AS taskId,
    participant_names_json AS participantNamesJson,
    company_label_snapshot AS companyLabel, contact_label_snapshot AS contactLabel,
    deal_label_snapshot AS dealLabel, created_at AS createdAt, updated_at AS updatedAt, version`;
  const activitySession = (request: express.Request) =>
    auth.authenticate(cookieToken(request.headers.cookie));
  const sendActivityError = (error: unknown, response: express.Response) => {
    if (error instanceof AuthError)
      return response.status(error.code === 'FORBIDDEN' ? 403 : 401).json({
        error: {
          code: error.code,
          message:
            error.code === 'FORBIDDEN'
              ? 'You do not have permission to do that.'
              : 'Please sign in to continue.',
        },
      });
    if (error instanceof z.ZodError)
      return response.status(400).json({
        error: { code: 'VALIDATION', message: 'Check the activity fields and try again.' },
      });
    if (String(error).includes('INVALID_ACTIVITY_RELATION'))
      return response.status(404).json({
        error: { code: 'NOT_FOUND', message: 'A related record was not found.' },
      });
    if (String(error).includes('INVALID_TASK_ASSIGNEE'))
      return response.status(400).json({
        error: { code: 'VALIDATION', message: 'The follow-up assignee must be an active member.' },
      });
    return response.status(500).json({
      error: { code: 'UNEXPECTED_ERROR', message: 'Something went wrong. Please try again.' },
    });
  };
  const relatedLabels = (
    organizationId: string,
    input: { companyId?: string | null; contactId?: string | null; dealId?: string | null },
  ) => {
    const company = input.companyId
      ? database
          .prepare('SELECT name FROM companies WHERE id = ? AND organization_id = ?')
          .get(input.companyId, organizationId)
      : null;
    const contact = input.contactId
      ? database
          .prepare(
            'SELECT first_name, last_name FROM contacts WHERE id = ? AND organization_id = ?',
          )
          .get(input.contactId, organizationId)
      : null;
    const deal = input.dealId
      ? database
          .prepare('SELECT name FROM deals WHERE id = ? AND organization_id = ?')
          .get(input.dealId, organizationId)
      : null;
    if ((input.companyId && !company) || (input.contactId && !contact) || (input.dealId && !deal))
      throw new Error('INVALID_ACTIVITY_RELATION');
    return {
      companyLabel: company?.name || null,
      contactLabel: contact ? `${contact.first_name} ${contact.last_name}` : null,
      dealLabel: deal?.name || null,
    };
  };
  const assertTaskAssignee = (organizationId: string, assigneeId: string | null | undefined) => {
    if (!assigneeId) return;
    if (
      !database
        .prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?')
        .get(organizationId, assigneeId)
    )
      throw new Error('INVALID_TASK_ASSIGNEE');
  };
  const auditContact = (
    organizationId: string,
    actorId: string,
    action: string,
    contactId: string,
    summary: unknown,
  ) =>
    database
      .prepare(
        'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `aud_${randomUUID()}`,
        organizationId,
        actorId,
        action,
        'contact',
        contactId,
        JSON.stringify(summary),
        new Date().toISOString(),
      );
  const assertContactOwner = (organizationId: string, ownerId: string | null | undefined) => {
    if (!ownerId) return;
    const membership = database
      .prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?')
      .get(organizationId, ownerId);
    if (!membership) throw new Error('INVALID_CONTACT_OWNER');
  };
  const importColumns = {
    companies: [
      'name',
      'externalreference',
      'website',
      'phone',
      'industry',
      'size',
      'address',
      'lifecyclestatus',
      'tags',
      'description',
    ],
    contacts: [
      'firstname',
      'lastname',
      'email',
      'phone',
      'jobtitle',
      'status',
      'tags',
      'communicationpreference',
    ],
  } as const;
  const previewImport = (
    organizationId: string,
    resource: 'companies' | 'contacts',
    csv: string,
    mapping?: Record<string, string>,
  ) => {
    const parsed = parseCsv(csv);
    const accepted = new Set(importColumns[resource]);
    const resolved = Object.fromEntries(
      Object.entries(
        mapping || Object.fromEntries(parsed.headers.map((header) => [header, header])),
      )
        .map(([target, header]) => [
          target,
          String(header)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ''),
        ])
        .filter(
          ([target, header]) => accepted.has(target as never) && parsed.headers.includes(header),
        ),
    );
    const valueAt = (values: string[], target: string) => {
      const header = resolved[target];
      return header ? values[parsed.headers.indexOf(header)] || '' : '';
    };
    const seenKeys = new Set<string>();
    const rows = parsed.rows.map((values, index) => {
      const row = Object.fromEntries(
        importColumns[resource].map((key) => [key, valueAt(values, key)]),
      );
      const errors: string[] = [];
      if (resource === 'companies' && !row.name) errors.push('Name is required.');
      if (resource === 'contacts' && (!row.firstname || !row.lastname))
        errors.push('First and last name are required.');
      if (
        resource === 'contacts' &&
        row.email &&
        !z.string().email().safeParse(row.email.trim()).success
      )
        errors.push('Email is invalid.');
      const key = resource === 'companies' ? row.externalreference : row.email.toLowerCase();
      if (key && seenKeys.has(key)) errors.push('Duplicate key appears in this CSV.');
      if (key) seenKeys.add(key);
      const duplicate =
        key &&
        database
          .prepare(
            resource === 'companies'
              ? 'SELECT id, name FROM companies WHERE organization_id = ? AND external_reference = ? AND archived_at IS NULL'
              : "SELECT id, first_name || ' ' || last_name AS name FROM contacts WHERE organization_id = ? AND lower(email) = ? AND archived_at IS NULL",
          )
          .get(organizationId, key);
      return { line: index + 2, values: row, errors, duplicate: duplicate || null };
    });
    return {
      resource,
      mapping: resolved,
      rows,
      validRows: rows.filter((row) => !row.errors.length && !row.duplicate).length,
    };
  };
  const sessionCookie = (token: string, expiresAt: string) =>
    `northstar_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${config.environment === 'production' ? '; Secure' : ''}`;

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', environment: config.environment });
  });

  app.post('/api/auth/sign-in', (request, response) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      });
    try {
      const session = auth.signIn(parsed.data);
      response.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      return response.status(200).json({
        user: session.user,
        organizationId: session.organizationId,
        organization: session.organization,
        role: session.role,
      });
    } catch (error) {
      return response.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      });
    }
  });
  app.get('/api/auth/session', (request, response) => {
    try {
      return response.json(auth.authenticate(cookieToken(request.headers.cookie)));
    } catch (error) {
      const expired = error instanceof AuthError && error.code === 'SESSION_EXPIRED';
      return response.status(401).json({
        error: {
          code: expired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
          message: expired
            ? 'Your session has expired. Please sign in again.'
            : 'Please sign in to continue.',
        },
      });
    }
  });
  app.post('/api/auth/logout', (request, response) => {
    auth.logout(cookieToken(request.headers.cookie));
    response.setHeader(
      'Set-Cookie',
      'northstar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
    return response.status(204).end();
  });

  const contactSession = (request: express.Request) =>
    auth.authenticate(cookieToken(request.headers.cookie));
  const sendContactError = (error: unknown, response: express.Response) => {
    if (error instanceof AuthError)
      return response.status(error.code === 'FORBIDDEN' ? 403 : 401).json({
        error: {
          code: error.code,
          message:
            error.code === 'FORBIDDEN'
              ? 'You do not have permission to do that.'
              : 'Please sign in to continue.',
        },
      });
    if (error instanceof z.ZodError)
      return response.status(400).json({
        error: { code: 'VALIDATION', message: 'Check the contact fields and try again.' },
      });
    if (String(error).includes('INVALID_CONTACT_OWNER'))
      return response.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'The contact owner must belong to this organization.',
        },
      });
    if (String(error).includes('UNIQUE constraint'))
      return response.status(409).json({
        error: {
          code: 'DUPLICATE',
          message: 'A contact with that email already exists in this organization.',
        },
      });
    return response.status(500).json({
      error: { code: 'UNEXPECTED_ERROR', message: 'Something went wrong. Please try again.' },
    });
  };
  app.get('/api/contacts', (request, response) => {
    try {
      const s = contactSession(request);
      const page = Math.max(1, Number(request.query.page) || 1);
      const size = Math.min(100, Math.max(1, Number(request.query.pageSize) || 25));
      const query = String(request.query.query || '').trim();
      const companyId =
        typeof request.query.companyId === 'string' ? request.query.companyId : null;
      const status = typeof request.query.status === 'string' ? request.query.status : null;
      const ownerId = typeof request.query.ownerId === 'string' ? request.query.ownerId : null;
      const tag = typeof request.query.tag === 'string' ? request.query.tag : null;
      const sort = typeof request.query.sort === 'string' ? request.query.sort : 'name';
      const direction = request.query.direction === 'desc' ? 'DESC' : 'ASC';
      const archived = request.query.archived === 'true';
      const where = [
        'organization_id = ?',
        archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL',
      ];
      const args: unknown[] = [s.organizationId];
      if (query) {
        where.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)');
        args.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }
      if (companyId) {
        where.push('company_id = ?');
        args.push(companyId);
      }
      if (status) {
        where.push('status = ?');
        args.push(status);
      }
      if (ownerId) {
        where.push('owner_id = ?');
        args.push(ownerId);
      }
      if (tag) {
        where.push('EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)');
        args.push(tag);
      }
      const clause = where.join(' AND ');
      const order =
        sort === 'createdAt'
          ? `created_at ${direction}`
          : sort === 'updatedAt'
            ? `updated_at ${direction}`
            : sort === 'email'
              ? `email COLLATE NOCASE ${direction}`
              : `last_name COLLATE NOCASE ${direction}, first_name COLLATE NOCASE ${direction}`;
      const total = database
        .prepare(`SELECT count(*) AS total FROM contacts WHERE ${clause}`)
        .get(...args).total;
      const items = database
        .prepare(
          `SELECT ${contactFields} FROM contacts WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
        )
        .all(...args, size, (page - 1) * size);
      return response.json({ items, page, pageSize: size, total });
    } catch (e) {
      return sendContactError(e, response);
    }
  });
  app.post('/api/contacts', (request, response) => {
    try {
      const s = auth.requireRole(contactSession(request), ['owner', 'member']);
      const c = contactInput.parse(request.body);
      const now = new Date().toISOString();
      const id = `ct_${randomUUID()}`;
      const email = c.email ? c.email.toLowerCase() : null;
      assertContactOwner(s.organizationId, c.ownerId || s.userId);
      const duplicate =
        email &&
        database
          .prepare(
            'SELECT id, first_name AS firstName, last_name AS lastName FROM contacts WHERE organization_id = ? AND lower(email) = ? AND archived_at IS NULL',
          )
          .get(s.organizationId, email);
      transaction(() => {
        database
          .prepare(
            `INSERT INTO contacts (id, organization_id, company_id, first_name, last_name, email, phone, job_title, owner_id, status, tags_json, communication_preference, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            s.organizationId,
            c.companyId || null,
            c.firstName,
            c.lastName,
            email,
            c.phone || null,
            c.jobTitle || null,
            c.ownerId || s.userId,
            c.status,
            JSON.stringify(c.tags),
            c.communicationPreference,
            now,
            now,
          );
        auditContact(s.organizationId, s.userId, 'created', id, {
          email,
          companyId: c.companyId || null,
        });
      });
      return response.status(201).json({
        ...database.prepare(`SELECT ${contactFields} FROM contacts WHERE id = ?`).get(id),
        duplicateWarning: duplicate || null,
      });
    } catch (e) {
      return sendContactError(e, response);
    }
  });
  app.get('/api/contacts/:id', (request, response) => {
    try {
      const s = contactSession(request);
      const c = database
        .prepare(
          `SELECT contacts.id, contacts.first_name AS firstName, contacts.last_name AS lastName, contacts.email, contacts.phone, contacts.job_title AS jobTitle, contacts.company_id AS companyId, contacts.owner_id AS ownerId, contacts.status, contacts.tags_json AS tagsJson, contacts.communication_preference AS communicationPreference, contacts.created_at AS createdAt, contacts.updated_at AS updatedAt, contacts.archived_at AS archivedAt, contacts.version, companies.name AS companyName FROM contacts LEFT JOIN companies ON companies.id = contacts.company_id AND companies.organization_id = contacts.organization_id WHERE contacts.id = ? AND contacts.organization_id = ?`,
        )
        .get(request.params.id, s.organizationId);
      return c
        ? response.json({
            ...c,
            activities: database
              .prepare(
                `SELECT ${activityFields} FROM activities WHERE organization_id = ? AND contact_id = ? ORDER BY occurred_at DESC, id DESC`,
              )
              .all(s.organizationId, c.id),
            deals: database
              .prepare(
                'SELECT deals.id, deals.name, deals.status FROM deal_contacts JOIN deals ON deals.id = deal_contacts.deal_id WHERE deal_contacts.organization_id = ? AND deal_contacts.contact_id = ?',
              )
              .all(s.organizationId, c.id),
            tasks: database
              .prepare(
                'SELECT id, title, status, due_at AS dueAt FROM tasks WHERE organization_id = ? AND contact_id = ? ORDER BY due_at',
              )
              .all(s.organizationId, c.id),
            history: database
              .prepare(
                "SELECT id, action, created_at AS createdAt, summary_json AS summaryJson FROM audit_events WHERE organization_id = ? AND entity_type = 'contact' AND entity_id = ? ORDER BY created_at DESC",
              )
              .all(s.organizationId, c.id),
          })
        : response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
    } catch (e) {
      return sendContactError(e, response);
    }
  });
  app.patch('/api/contacts/:id', (request, response) => {
    try {
      const s = auth.requireRole(contactSession(request), ['owner', 'member']);
      const c = contactUpdateInput.parse(request.body);
      const now = new Date().toISOString();
      assertContactOwner(s.organizationId, c.ownerId);
      const email = c.email ? c.email.toLowerCase() : null;
      const duplicate =
        email &&
        database
          .prepare(
            'SELECT id, first_name AS firstName, last_name AS lastName FROM contacts WHERE organization_id = ? AND lower(email) = ? AND archived_at IS NULL AND id != ?',
          )
          .get(s.organizationId, email, request.params.id);
      const result = transaction(() => {
        const result = database
          .prepare(
            `UPDATE contacts SET company_id=?, first_name=?, last_name=?, email=?, phone=?, job_title=?, owner_id=?, status=?, tags_json=?, communication_preference=?, updated_at=?, version=version+1 WHERE id=? AND organization_id=? AND archived_at IS NULL AND version = ?`,
          )
          .run(
            c.companyId || null,
            c.firstName,
            c.lastName,
            email,
            c.phone || null,
            c.jobTitle || null,
            c.ownerId || null,
            c.status,
            JSON.stringify(c.tags),
            c.communicationPreference,
            now,
            request.params.id,
            s.organizationId,
            c.version,
          );
        if (result.changes)
          auditContact(s.organizationId, s.userId, 'updated', request.params.id, {
            version: c.version || null,
          });
        return result;
      });
      if (!result.changes)
        return response.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'This contact changed or is unavailable. Refresh and try again.',
          },
        });
      return response.json({
        ...database
          .prepare(`SELECT ${contactFields} FROM contacts WHERE id = ?`)
          .get(request.params.id),
        duplicateWarning: duplicate || null,
      });
    } catch (e) {
      return sendContactError(e, response);
    }
  });
  app.post('/api/contacts/:id/:action', (request, response) => {
    try {
      const s = auth.requireRole(contactSession(request), ['owner', 'member']);
      if (!['archive', 'restore'].includes(request.params.action))
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'That action does not exist.' } });
      const archived = request.params.action === 'archive' ? new Date().toISOString() : null;
      const statePredicate = archived ? 'archived_at IS NULL' : 'archived_at IS NOT NULL';
      const result = transaction(() => {
        const result = database
          .prepare(
            `UPDATE contacts SET archived_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND ${statePredicate}`,
          )
          .run(archived, new Date().toISOString(), request.params.id, s.organizationId);
        if (result.changes)
          auditContact(
            s.organizationId,
            s.userId,
            archived ? 'archived' : 'restored',
            request.params.id,
            {},
          );
        return result;
      });
      if (result.changes) return response.status(204).end();
      const exists = database
        .prepare('SELECT 1 FROM contacts WHERE id = ? AND organization_id = ?')
        .get(request.params.id, s.organizationId);
      return exists
        ? response.status(409).json({
            error: { code: 'CONFLICT', message: 'This contact is already in that state.' },
          })
        : response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
    } catch (e) {
      return sendContactError(e, response);
    }
  });

  const taskSession = (request: express.Request) =>
    auth.authenticate(cookieToken(request.headers.cookie));
  const sendTaskError = (error: unknown, response: express.Response) => {
    if (error instanceof AuthError)
      return response.status(error.code === 'FORBIDDEN' ? 403 : 401).json({
        error: {
          code: error.code,
          message:
            error.code === 'FORBIDDEN'
              ? 'You do not have permission to do that.'
              : 'Please sign in to continue.',
        },
      });
    if (error instanceof z.ZodError)
      return response
        .status(400)
        .json({ error: { code: 'VALIDATION', message: 'Check the task fields and try again.' } });
    if (String(error).includes('INVALID_TASK_REFERENCE'))
      return response.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Task relationships and assignee must belong to this organization.',
        },
      });
    return response.status(500).json({
      error: { code: 'UNEXPECTED_ERROR', message: 'Something went wrong. Please try again.' },
    });
  };
  const validateTaskReferences = (organizationId: string, input: z.infer<typeof taskInput>) => {
    for (const [table, id] of [
      ['memberships', input.assigneeId],
      ['companies', input.companyId],
      ['contacts', input.contactId],
      ['deals', input.dealId],
    ] as const) {
      if (!id) continue;
      const field = table === 'memberships' ? 'user_id' : 'id';
      if (
        !database
          .prepare(`SELECT 1 FROM ${table} WHERE organization_id = ? AND ${field} = ?`)
          .get(organizationId, id)
      )
        throw new Error('INVALID_TASK_REFERENCE');
    }
  };
  const auditTask = (
    organizationId: string,
    actorId: string,
    action: string,
    id: string,
    summary: unknown,
  ) =>
    database
      .prepare(
        'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `aud_${randomUUID()}`,
        organizationId,
        actorId,
        action,
        'task',
        id,
        JSON.stringify(summary),
        new Date().toISOString(),
      );
  app.get('/api/tasks', (request, response) => {
    try {
      const s = taskSession(request);
      const query = taskListQuery.parse(request.query);
      const where = ['organization_id = ?'];
      const args: unknown[] = [s.organizationId];
      if (!query.includeArchived) where.push('archived_at IS NULL');
      if (query.text) {
        where.push('(title LIKE ? OR description LIKE ?)');
        args.push(`%${query.text}%`, `%${query.text}%`);
      }
      if (query.assigneeId === 'me') {
        where.push('assignee_id = ?');
        args.push(s.userId);
      } else if (query.assigneeId) {
        where.push('assignee_id = ?');
        args.push(query.assigneeId);
      }
      if (query.status) {
        where.push('status = ?');
        args.push(query.status);
      }
      if (query.relation && query.relationId) {
        where.push(`${query.relation}_id = ?`);
        args.push(query.relationId);
      }
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const tomorrow = new Date(`${today}T00:00:00.000Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      if (query.due === 'completed') where.push("status = 'completed'");
      if (query.due === 'overdue') {
        where.push("status NOT IN ('completed', 'cancelled') AND due_at < ?");
        args.push(now.toISOString());
      }
      if (query.due === 'today') {
        where.push("status NOT IN ('completed', 'cancelled') AND due_at >= ? AND due_at < ?");
        args.push(`${today}T00:00:00.000Z`, tomorrow.toISOString());
      }
      if (query.due === 'upcoming') {
        where.push("status NOT IN ('completed', 'cancelled') AND due_at >= ?");
        args.push(tomorrow.toISOString());
      }
      const order = {
        dueAt: 'due_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        priority: "CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
      }[query.sort];
      const clause = where.join(' AND ');
      const total = database
        .prepare(`SELECT count(*) AS total FROM tasks WHERE ${clause}`)
        .get(...args).total;
      return response.json({
        items: database
          .prepare(
            `SELECT * FROM tasks WHERE ${clause} ORDER BY ${order} ${query.direction.toUpperCase()}, id ASC LIMIT ? OFFSET ?`,
          )
          .all(...args, query.pageSize, (query.page - 1) * query.pageSize),
        total,
        page: query.page,
        pageSize: query.pageSize,
        timezone: 'UTC',
      });
    } catch (error) {
      return sendTaskError(error, response);
    }
  });
  app.post('/api/tasks', (request, response) => {
    try {
      const s = auth.requireRole(taskSession(request), ['owner', 'member']);
      const input = taskInput.parse(request.body);
      validateTaskReferences(s.organizationId, input);
      const id = `task_${randomUUID()}`;
      const now = new Date().toISOString();
      const completedAt = input.status === 'completed' ? now : null;
      transaction(() => {
        database
          .prepare(
            'INSERT INTO tasks (id, organization_id, title, description, assignee_id, due_at, priority, status, company_id, contact_id, deal_id, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            s.organizationId,
            input.title,
            input.description,
            input.assigneeId || null,
            input.dueAt || null,
            input.priority,
            input.status,
            input.companyId || null,
            input.contactId || null,
            input.dealId || null,
            completedAt,
            now,
            now,
          );
        auditTask(s.organizationId, s.userId, 'task.created', id, { title: input.title });
      });
      return response
        .status(201)
        .json(database.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
    } catch (error) {
      return sendTaskError(error, response);
    }
  });
  app.get('/api/tasks/:id', (request, response) => {
    try {
      const s = taskSession(request);
      const task = database
        .prepare('SELECT * FROM tasks WHERE id = ? AND organization_id = ?')
        .get(request.params.id, s.organizationId);
      return task
        ? response.json({
            ...task,
            history: database
              .prepare(
                "SELECT * FROM audit_events WHERE organization_id = ? AND entity_type = 'task' AND entity_id = ? ORDER BY created_at DESC",
              )
              .all(s.organizationId, task.id),
          })
        : response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
    } catch (error) {
      return sendTaskError(error, response);
    }
  });
  app.put('/api/tasks/:id', (request, response) => {
    try {
      const s = auth.requireRole(taskSession(request), ['owner', 'member']);
      const input = taskUpdateInput.parse(request.body);
      const existing = database
        .prepare('SELECT * FROM tasks WHERE id = ? AND organization_id = ?')
        .get(request.params.id, s.organizationId);
      if (!existing)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
      if (existing.version !== input.version)
        return response.status(409).json({
          error: { code: 'CONFLICT', message: 'This task changed. Refresh it before saving.' },
        });
      validateTaskReferences(s.organizationId, input);
      const now = new Date().toISOString();
      const completedAt = input.status === 'completed' ? existing.completed_at || now : null;
      transaction(() => {
        database
          .prepare(
            'UPDATE tasks SET title=?, description=?, assignee_id=?, due_at=?, priority=?, status=?, company_id=?, contact_id=?, deal_id=?, completed_at=?, updated_at=?, version=version+1 WHERE id=? AND organization_id=? AND version=?',
          )
          .run(
            input.title,
            input.description,
            input.assigneeId || null,
            input.dueAt || null,
            input.priority,
            input.status,
            input.companyId || null,
            input.contactId || null,
            input.dealId || null,
            completedAt,
            now,
            existing.id,
            s.organizationId,
            input.version,
          );
        auditTask(s.organizationId, s.userId, 'task.updated', existing.id, {
          status: input.status,
        });
      });
      return response.json(database.prepare('SELECT * FROM tasks WHERE id = ?').get(existing.id));
    } catch (error) {
      return sendTaskError(error, response);
    }
  });
  app.post('/api/tasks/:id/:action', (request, response) => {
    try {
      const s = auth.requireRole(taskSession(request), ['owner', 'member']);
      const action = request.params.action;
      if (!['archive', 'restore', 'complete', 'reopen'].includes(action))
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'That action does not exist.' } });
      const task = database
        .prepare('SELECT * FROM tasks WHERE id = ? AND organization_id = ?')
        .get(request.params.id, s.organizationId);
      if (!task)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
      const now = new Date().toISOString();
      const nextStatus =
        action === 'complete' ? 'completed' : action === 'reopen' ? 'open' : task.status;
      const archived = action === 'archive' ? now : action === 'restore' ? null : task.archived_at;
      transaction(() => {
        database
          .prepare(
            'UPDATE tasks SET status=?, completed_at=?, archived_at=?, updated_at=?, version=version+1 WHERE id=? AND organization_id=?',
          )
          .run(
            nextStatus,
            nextStatus === 'completed' ? task.completed_at || now : null,
            archived,
            now,
            task.id,
            s.organizationId,
          );
        auditTask(s.organizationId, s.userId, `task.${action}d`, task.id, {});
      });
      return response.json(database.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
    } catch (error) {
      return sendTaskError(error, response);
    }
  });

  app.get('/api/companies', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const query = companyListQuery.parse(request.query);
      const terms = ['organization_id = ?'];
      const values: unknown[] = [session.organizationId];
      if (!query.includeArchived) terms.push('archived_at IS NULL');
      if (query.text) {
        terms.push('(name LIKE ? OR external_reference LIKE ?)');
        values.push(`%${query.text}%`, `%${query.text}%`);
      }
      if (query.lifecycle) {
        terms.push('lifecycle_status = ?');
        values.push(query.lifecycle);
      }
      if (query.ownerId) {
        terms.push('owner_id = ?');
        values.push(query.ownerId);
      }
      if (query.industry) {
        terms.push('industry = ?');
        values.push(query.industry);
      }
      if (query.size) {
        terms.push('size = ?');
        values.push(query.size);
      }
      if (query.tag) {
        terms.push('EXISTS (SELECT 1 FROM json_each(companies.tags_json) WHERE value = ?)');
        values.push(query.tag);
      }
      const where = terms.join(' AND ');
      const order = {
        name: 'name COLLATE NOCASE',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        lifecycle: 'lifecycle_status',
      }[query.sort];
      const total = database
        .prepare(`SELECT count(*) AS total FROM companies WHERE ${where}`)
        .get(...values).total;
      const rows = database
        .prepare(
          `SELECT * FROM companies WHERE ${where} ORDER BY ${order} ${query.direction.toUpperCase()}, id ASC LIMIT ? OFFSET ?`,
        )
        .all(...values, query.pageSize, (query.page - 1) * query.pageSize);
      return response.json({ items: rows, page: query.page, pageSize: query.pageSize, total });
    } catch (error) {
      if (error instanceof AuthError)
        return response.status(401).json({
          error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' },
        });
      return response
        .status(400)
        .json({ error: { code: 'VALIDATION', message: 'Check the list filters and try again.' } });
    }
  });
  app.post('/api/companies', (request, response) => {
    try {
      const session = auth.requireRole(auth.authenticate(cookieToken(request.headers.cookie)), [
        'owner',
        'member',
      ]);
      const input = companyInput.parse(request.body);
      const ownerId = input.ownerId === undefined ? session.userId : input.ownerId;
      if (
        ownerId !== null &&
        !database
          .prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?')
          .get(session.organizationId, ownerId)
      )
        return response.status(400).json({
          error: { code: 'VALIDATION', message: 'Company owner must belong to this organization.' },
        });
      const now = new Date().toISOString();
      const id = `co_${randomUUID()}`;
      database.exec('BEGIN IMMEDIATE');
      try {
        database
          .prepare(
            'INSERT INTO companies (id, organization_id, name, external_reference, website, phone, industry, size, address, lifecycle_status, owner_id, tags_json, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            session.organizationId,
            input.name,
            input.externalReference || null,
            input.website || null,
            input.phone || null,
            input.industry || null,
            input.size || null,
            input.address || null,
            input.lifecycleStatus,
            ownerId,
            JSON.stringify(input.tags),
            input.description,
            now,
            now,
          );
        database
          .prepare(
            'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `aud_${randomUUID()}`,
            session.organizationId,
            session.userId,
            'company.created',
            'company',
            id,
            JSON.stringify({ name: input.name }),
            now,
          );
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return response
        .status(201)
        .json(database.prepare('SELECT * FROM companies WHERE id = ?').get(id));
    } catch (error) {
      if (error instanceof AuthError && error.code === 'FORBIDDEN')
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          },
        });
      if (error instanceof AuthError)
        return response
          .status(401)
          .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
      if (String(error).includes('UNIQUE constraint failed'))
        return response.status(409).json({
          error: { code: 'CONFLICT', message: 'A company already uses this external reference.' },
        });
      return response.status(400).json({
        error: { code: 'VALIDATION', message: 'Check the company fields and try again.' },
      });
    }
  });

  app.get('/api/companies/:id', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const company = database
        .prepare('SELECT * FROM companies WHERE id = ? AND organization_id = ?')
        .get(request.params.id, session.organizationId);
      if (!company)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
      return response.json({
        ...company,
        contacts: database
          .prepare(
            'SELECT * FROM contacts WHERE organization_id = ? AND company_id = ? ORDER BY last_name, first_name',
          )
          .all(session.organizationId, company.id),
        activities: database
          .prepare(
            `SELECT ${activityFields} FROM activities WHERE organization_id = ? AND company_id = ? ORDER BY occurred_at DESC, id DESC`,
          )
          .all(session.organizationId, company.id),
        deals: database
          .prepare(
            'SELECT * FROM deals WHERE organization_id = ? AND company_id = ? ORDER BY updated_at DESC, id DESC',
          )
          .all(session.organizationId, company.id),
        tasks: database
          .prepare(
            'SELECT * FROM tasks WHERE organization_id = ? AND company_id = ? ORDER BY due_at ASC, id ASC',
          )
          .all(session.organizationId, company.id),
        history: database
          .prepare(
            "SELECT * FROM audit_events WHERE organization_id = ? AND entity_type = 'company' AND entity_id = ? ORDER BY created_at DESC, id DESC",
          )
          .all(session.organizationId, company.id),
      });
    } catch (error) {
      if (error instanceof AuthError && error.code === 'FORBIDDEN') {
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          },
        });
      }
      return response
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
    }
  });
  app.put('/api/companies/:id', (request, response) => {
    try {
      const session = auth.requireRole(auth.authenticate(cookieToken(request.headers.cookie)), [
        'owner',
        'member',
      ]);
      const company = database
        .prepare('SELECT * FROM companies WHERE id = ? AND organization_id = ?')
        .get(request.params.id, session.organizationId);
      if (!company)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
      const input = companyUpdate.parse(request.body);
      if (company.version !== input.version)
        return response.status(409).json({
          error: { code: 'CONFLICT', message: 'This company changed. Refresh it before saving.' },
        });
      const ownerId = input.ownerId === undefined ? company.owner_id : input.ownerId;
      if (
        ownerId !== null &&
        !database
          .prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?')
          .get(session.organizationId, ownerId)
      )
        return response.status(400).json({
          error: { code: 'VALIDATION', message: 'Company owner must belong to this organization.' },
        });
      const now = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        const update = database
          .prepare(
            'UPDATE companies SET name = ?, external_reference = ?, website = ?, phone = ?, industry = ?, size = ?, address = ?, lifecycle_status = ?, owner_id = ?, tags_json = ?, description = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?',
          )
          .run(
            input.name,
            input.externalReference || null,
            input.website || null,
            input.phone || null,
            input.industry || null,
            input.size || null,
            input.address || null,
            input.lifecycleStatus,
            ownerId,
            JSON.stringify(input.tags),
            input.description,
            now,
            company.id,
            session.organizationId,
            input.version,
          );
        if (!update.changes) throw new AuthError('CONFLICT');
        database
          .prepare(
            'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `aud_${randomUUID()}`,
            session.organizationId,
            session.userId,
            'company.updated',
            'company',
            company.id,
            JSON.stringify({ changed: ['company fields'] }),
            now,
          );
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return response.json(
        database.prepare('SELECT * FROM companies WHERE id = ?').get(company.id),
      );
    } catch (error) {
      if (error instanceof AuthError && error.code === 'FORBIDDEN') {
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          },
        });
      }
      if (error instanceof AuthError && error.code === 'CONFLICT')
        return response.status(409).json({
          error: { code: 'CONFLICT', message: 'This company changed. Refresh it before saving.' },
        });
      if (String(error).includes('UNIQUE constraint failed'))
        return response.status(409).json({
          error: { code: 'CONFLICT', message: 'A company already uses this external reference.' },
        });
      if (error instanceof z.ZodError)
        return response.status(400).json({
          error: { code: 'VALIDATION', message: 'Check the company fields and try again.' },
        });
      return response
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
    }
  });
  for (const [action, value] of [
    ['archive', 'archived'],
    ['restore', 'restored'],
  ] as const) {
    app.post(`/api/companies/:id/${action}`, (request, response) => {
      try {
        const session = auth.requireRole(auth.authenticate(cookieToken(request.headers.cookie)), [
          'owner',
          'member',
        ]);
        const company = database
          .prepare('SELECT * FROM companies WHERE id = ? AND organization_id = ?')
          .get(request.params.id, session.organizationId);
        if (!company)
          return response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
        if (
          (action === 'archive' && company.archived_at) ||
          (action === 'restore' && !company.archived_at)
        )
          return response.json(company);
        const now = new Date().toISOString();
        database.exec('BEGIN IMMEDIATE');
        try {
          database
            .prepare(
              'UPDATE companies SET archived_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ?',
            )
            .run(action === 'archive' ? now : null, now, company.id, session.organizationId);
          database
            .prepare(
              'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              `aud_${randomUUID()}`,
              session.organizationId,
              session.userId,
              `company.${value}`,
              'company',
              company.id,
              JSON.stringify({ archived: action === 'archive' }),
              now,
            );
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
        return response.json(
          database.prepare('SELECT * FROM companies WHERE id = ?').get(company.id),
        );
      } catch (error) {
        if ((error as { code?: string })?.code === 'FORBIDDEN')
          return response.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have permission to perform this action.',
            },
          });
        if (error instanceof z.ZodError)
          return response.status(400).json({
            error: { code: 'VALIDATION', message: 'Check the company fields and try again.' },
          });
        return response
          .status(401)
          .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
      }
    });
  }

  app.get('/api/search', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const params = new URL(request.originalUrl, 'http://localhost').searchParams;
      const { q, limit } = searchQuery.parse({
        q: params.get('q') ?? undefined,
        limit: params.get('limit') ?? undefined,
      });
      const like = `%${q}%`;
      const grouped = {
        companies: database
          .prepare(
            'SELECT id, name AS label, coalesce(industry, lifecycle_status) AS context FROM companies WHERE organization_id = ? AND archived_at IS NULL AND (name LIKE ? OR external_reference LIKE ?) ORDER BY name COLLATE NOCASE, id LIMIT ?',
          )
          .all(session.organizationId, like, like, limit),
        contacts: database
          .prepare(
            "SELECT id, first_name || ' ' || last_name AS label, coalesce(email, job_title, '') AS context FROM contacts WHERE organization_id = ? AND archived_at IS NULL AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?) ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, id LIMIT ?",
          )
          .all(session.organizationId, like, like, like, limit),
        deals: database
          .prepare(
            "SELECT id, name AS label, currency || ' ' || amount_cents AS context FROM deals WHERE organization_id = ? AND archived_at IS NULL AND name LIKE ? ORDER BY updated_at DESC, id LIMIT ?",
          )
          .all(session.organizationId, like, limit),
        tasks: database
          .prepare(
            'SELECT id, title AS label, status AS context FROM tasks WHERE organization_id = ? AND archived_at IS NULL AND (title LIKE ? OR description LIKE ?) ORDER BY updated_at DESC, id LIMIT ?',
          )
          .all(session.organizationId, like, like, limit),
      };
      return response.json({ query: q, groups: grouped });
    } catch (error) {
      if (error instanceof AuthError)
        return response.status(401).json({
          error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' },
        });
      return response.status(400).json({
        error: { code: 'VALIDATION', message: 'Enter a search term up to 200 characters.' },
      });
    }
  });

  app.get('/api/saved-views', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const params = new URL(request.originalUrl, 'http://localhost').searchParams;
      const resource = z
        .enum(['companies', 'contacts', 'deals', 'tasks'])
        .optional()
        .parse(params.get('resource') ?? undefined);
      const suffix = resource ? ' AND resource = ?' : '';
      const rows = database
        .prepare(
          `SELECT id, resource, name, filters_json AS filtersJson, created_at AS createdAt, updated_at AS updatedAt FROM saved_views WHERE organization_id = ? AND user_id = ?${suffix} ORDER BY resource, name COLLATE NOCASE`,
        )
        .all(session.organizationId, session.userId, ...(resource ? [resource] : []));
      return response.json({
        items: rows.map((row: any) => ({ ...row, filters: JSON.parse(row.filtersJson) })),
      });
    } catch (error) {
      return response.status(error instanceof AuthError ? 401 : 400).json({
        error: {
          code: error instanceof AuthError ? 'UNAUTHENTICATED' : 'VALIDATION',
          message: 'Saved views could not be loaded.',
        },
      });
    }
  });
  app.post('/api/saved-views', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const input = savedViewInput.parse(request.body);
      const now = new Date().toISOString();
      const id = `view_${randomUUID()}`;
      database
        .prepare(
          'INSERT INTO saved_views (id, organization_id, user_id, resource, name, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          session.organizationId,
          session.userId,
          input.resource,
          input.name,
          JSON.stringify(input.filters),
          now,
          now,
        );
      return response.status(201).json({ id, ...input, createdAt: now, updatedAt: now });
    } catch (error) {
      if (String(error).includes('UNIQUE constraint'))
        return response
          .status(409)
          .json({ error: { code: 'CONFLICT', message: 'A saved view already has this name.' } });
      return response.status(error instanceof AuthError ? 401 : 400).json({
        error: {
          code: error instanceof AuthError ? 'UNAUTHENTICATED' : 'VALIDATION',
          message: 'Saved view could not be created.',
        },
      });
    }
  });
  app.put('/api/saved-views/:id', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const input = savedViewInput.parse(request.body);
      const result = database
        .prepare(
          'UPDATE saved_views SET resource = ?, name = ?, filters_json = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND user_id = ?',
        )
        .run(
          input.resource,
          input.name,
          JSON.stringify(input.filters),
          new Date().toISOString(),
          request.params.id,
          session.organizationId,
          session.userId,
        );
      if (!result.changes)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'Saved view was not found.' } });
      return response.status(204).end();
    } catch (error) {
      return response.status(error instanceof AuthError ? 401 : 400).json({
        error: {
          code: error instanceof AuthError ? 'UNAUTHENTICATED' : 'VALIDATION',
          message: 'Saved view could not be updated.',
        },
      });
    }
  });
  app.delete('/api/saved-views/:id', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const result = database
        .prepare('DELETE FROM saved_views WHERE id = ? AND organization_id = ? AND user_id = ?')
        .run(request.params.id, session.organizationId, session.userId);
      return result.changes
        ? response.status(204).end()
        : response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'Saved view was not found.' } });
    } catch (error) {
      return response
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
    }
  });

  app.get('/api/activities', (request, response) => {
    try {
      const session = activitySession(request);
      const query = activityListQuery.parse(request.query);
      const where = ['organization_id = ?'];
      const args: unknown[] = [session.organizationId];
      if (query.type) {
        where.push('type = ?');
        args.push(query.type);
      }
      if (query.authorId) {
        where.push('creator_id = ?');
        args.push(query.authorId);
      }
      if (query.relatedRecordId) {
        where.push('(company_id = ? OR contact_id = ? OR deal_id = ? OR task_id = ?)');
        args.push(
          query.relatedRecordId,
          query.relatedRecordId,
          query.relatedRecordId,
          query.relatedRecordId,
        );
      }
      if (query.from) {
        where.push('occurred_at >= ?');
        args.push(query.from);
      }
      if (query.to) {
        where.push('occurred_at <= ?');
        args.push(query.to);
      }
      const snapshotCreatedAt = query.snapshotCreatedAt || new Date().toISOString();
      where.push('created_at <= ?');
      args.push(snapshotCreatedAt);
      if (query.cursorOccurredAt && query.cursorId) {
        where.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
        args.push(query.cursorOccurredAt, query.cursorOccurredAt, query.cursorId);
      }
      const clause = where.join(' AND ');
      const total = database
        .prepare(`SELECT count(*) AS total FROM activities WHERE ${clause}`)
        .get(...args).total;
      const items = database
        .prepare(
          `SELECT ${activityFields} FROM activities WHERE ${clause} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
        )
        .all(...args, query.pageSize);
      const last = items.at(-1);
      return response.json({
        items,
        pageSize: query.pageSize,
        total,
        snapshotCreatedAt,
        nextCursor:
          items.length === query.pageSize && last
            ? { occurredAt: last.occurredAt, id: last.id }
            : null,
      });
    } catch (error) {
      return sendActivityError(error, response);
    }
  });

  app.get('/api/activities/:id', (request, response) => {
    try {
      const session = activitySession(request);
      const activity = database
        .prepare(`SELECT ${activityFields} FROM activities WHERE id = ? AND organization_id = ?`)
        .get(request.params.id, session.organizationId);
      return activity
        ? response.json(activity)
        : response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'This activity was not found.' } });
    } catch (error) {
      return sendActivityError(error, response);
    }
  });

  app.post('/api/activities', (request, response) => {
    try {
      const session = auth.requireRole(activitySession(request), ['owner', 'member']);
      const input = activityInput.parse(request.body);
      const id = `act_${randomUUID()}`;
      const taskId = input.followUp ? `task_${randomUUID()}` : null;
      const now = new Date().toISOString();
      const labels = relatedLabels(session.organizationId, input);
      assertTaskAssignee(session.organizationId, input.followUp?.assigneeId);
      transaction(() => {
        if (input.followUp)
          database
            .prepare(
              'INSERT INTO tasks (id, organization_id, title, description, assignee_id, due_at, priority, status, company_id, contact_id, deal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              taskId,
              session.organizationId,
              input.followUp.title,
              input.followUp.description,
              input.followUp.assigneeId || session.userId,
              input.followUp.dueAt || null,
              input.followUp.priority,
              'open',
              input.companyId || null,
              input.contactId || null,
              input.dealId || null,
              now,
              now,
            );
        database
          .prepare(
            `INSERT INTO activities (id, organization_id, type, subject, body, occurred_at, creator_id, company_id, contact_id, deal_id, task_id, participant_names_json, creator_name_snapshot, company_label_snapshot, contact_label_snapshot, deal_label_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            session.organizationId,
            input.type,
            input.subject,
            input.body,
            input.occurredAt,
            session.userId,
            input.companyId || null,
            input.contactId || null,
            input.dealId || null,
            taskId,
            JSON.stringify(input.participantNames),
            session.user.displayName,
            labels.companyLabel,
            labels.contactLabel,
            labels.dealLabel,
            now,
            now,
          );
      });
      return response.status(201).json({
        ...database.prepare(`SELECT ${activityFields} FROM activities WHERE id = ?`).get(id),
        followUpTaskId: taskId,
      });
    } catch (error) {
      return sendActivityError(error, response);
    }
  });

  app.patch('/api/activities/:id', (request, response) => {
    try {
      const session = auth.requireRole(activitySession(request), ['owner', 'member']);
      const input = activityUpdateInput.parse(request.body);
      const activity = database
        .prepare(
          'SELECT id, creator_id AS creatorId, created_at AS createdAt FROM activities WHERE id = ? AND organization_id = ?',
        )
        .get(request.params.id, session.organizationId);
      if (!activity)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This activity was not found.' } });
      const withinEditWindow = Date.now() - Date.parse(activity.createdAt) <= 15 * 60 * 1000;
      if ((session.role !== 'owner' && activity.creatorId !== session.userId) || !withinEditWindow)
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message:
              'Activities may only be edited by their creator or an owner within 15 minutes.',
          },
        });
      const result = database
        .prepare(
          'UPDATE activities SET subject = ?, body = ?, participant_names_json = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?',
        )
        .run(
          input.subject,
          input.body,
          JSON.stringify(input.participantNames),
          new Date().toISOString(),
          request.params.id,
          session.organizationId,
          input.version,
        );
      if (!result.changes)
        return response.status(409).json({
          error: { code: 'CONFLICT', message: 'This activity changed. Refresh it before saving.' },
        });
      return response.json(
        database
          .prepare(`SELECT ${activityFields} FROM activities WHERE id = ?`)
          .get(request.params.id),
      );
    } catch (error) {
      return sendActivityError(error, response);
    }
  });

  app.post('/api/imports/preview', (request, response) => {
    try {
      const session = auth.requireRole(contactSession(request), ['owner', 'member']);
      const input = importPreviewInput.parse(request.body);
      const result = previewImport(
        session.organizationId,
        input.resource,
        input.csv,
        input.mapping,
      );
      const id = `imp_${randomUUID()}`;
      database
        .prepare(
          'INSERT INTO imports (id, organization_id, created_by_id, resource, status, mapping_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          session.organizationId,
          session.userId,
          input.resource,
          'preview',
          JSON.stringify(result.mapping),
          JSON.stringify(result),
          new Date().toISOString(),
        );
      return response.status(201).json({ id, ...result });
    } catch (error) {
      if (error instanceof AuthError)
        return response.status(error.code === 'FORBIDDEN' ? 403 : 401).json({
          error: {
            code: error.code,
            message:
              error.code === 'FORBIDDEN'
                ? 'You do not have permission to import records.'
                : 'Please sign in to continue.',
          },
        });
      return response.status(400).json({
        error: {
          code: 'VALIDATION',
          message: error instanceof Error ? error.message : 'CSV preview could not be created.',
        },
      });
    }
  });
  app.post('/api/imports/:id/commit', (request, response) => {
    try {
      const session = auth.requireRole(contactSession(request), ['owner', 'member']);
      const preview = database
        .prepare('SELECT * FROM imports WHERE id = ? AND organization_id = ?')
        .get(request.params.id, session.organizationId);
      if (!preview)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This import preview was not found.' } });
      const result = JSON.parse(preview.result_json);
      if (preview.status === 'committed') return response.json(result);
      const now = new Date().toISOString();
      const committed = transaction(() => {
        const current = database
          .prepare('SELECT status, result_json FROM imports WHERE id = ? AND organization_id = ?')
          .get(preview.id, session.organizationId);
        if (current.status === 'committed') return JSON.parse(current.result_json);
        for (const row of result.rows.filter(
          (item: any) => !item.errors.length && !item.duplicate,
        )) {
          if (preview.resource === 'companies')
            database
              .prepare(
                'INSERT INTO companies (id, organization_id, name, external_reference, website, phone, industry, size, address, lifecycle_status, owner_id, tags_json, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              )
              .run(
                `co_${randomUUID()}`,
                session.organizationId,
                row.values.name,
                row.values.externalreference || null,
                row.values.website || null,
                row.values.phone || null,
                row.values.industry || null,
                row.values.size || null,
                row.values.address || null,
                ['lead', 'prospect', 'customer', 'inactive'].includes(row.values.lifecyclestatus)
                  ? row.values.lifecyclestatus
                  : 'lead',
                session.userId,
                JSON.stringify(normalizeTags(row.values.tags)),
                row.values.description || '',
                now,
                now,
              );
          else
            database
              .prepare(
                'INSERT INTO contacts (id, organization_id, first_name, last_name, email, phone, job_title, owner_id, status, tags_json, communication_preference, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              )
              .run(
                `ct_${randomUUID()}`,
                session.organizationId,
                row.values.firstname,
                row.values.lastname,
                row.values.email ? row.values.email.toLowerCase() : null,
                row.values.phone || null,
                row.values.jobtitle || null,
                session.userId,
                ['active', 'inactive', 'lead'].includes(row.values.status)
                  ? row.values.status
                  : 'active',
                JSON.stringify(normalizeTags(row.values.tags)),
                ['email', 'phone', 'none'].includes(row.values.communicationpreference)
                  ? row.values.communicationpreference
                  : 'email',
                now,
                now,
              );
        }
        result.status = 'committed';
        database
          .prepare(
            'UPDATE imports SET status = ?, result_json = ?, committed_at = ? WHERE id = ? AND organization_id = ?',
          )
          .run('committed', JSON.stringify(result), now, preview.id, session.organizationId);
        return result;
      });
      return response.json(committed);
    } catch (error) {
      if (error instanceof AuthError)
        return response.status(error.code === 'FORBIDDEN' ? 403 : 401).json({
          error: { code: error.code, message: 'You do not have permission to import records.' },
        });
      return response
        .status(400)
        .json({ error: { code: 'IMPORT_FAILED', message: 'The import could not be committed.' } });
    }
  });
  app.get('/api/exports/:resource.csv', (request, response) => {
    try {
      const session = contactSession(request);
      const resource = request.params.resource;
      if (!['companies', 'contacts'].includes(resource))
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This export does not exist.' } });
      const query =
        resource === 'companies'
          ? companyListQuery.parse(request.query)
          : { text: String(request.query.text || '').trim() };
      const companyQuery: any = query;
      const companyTerms = ['organization_id = ?'];
      const companyValues: unknown[] = [session.organizationId];
      if (companyQuery.includeArchived !== true) companyTerms.push('archived_at IS NULL');
      if (companyQuery.text) {
        companyTerms.push('(name LIKE ? OR external_reference LIKE ?)');
        companyValues.push(`%${companyQuery.text}%`, `%${companyQuery.text}%`);
      }
      for (const [field, column] of [
        ['lifecycle', 'lifecycle_status'],
        ['ownerId', 'owner_id'],
        ['industry', 'industry'],
        ['size', 'size'],
      ] as const)
        if (companyQuery[field]) {
          companyTerms.push(`${column} = ?`);
          companyValues.push(companyQuery[field]);
        }
      if (companyQuery.tag) {
        companyTerms.push('EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)');
        companyValues.push(companyQuery.tag);
      }
      const rows =
        resource === 'companies'
          ? database
              .prepare(
                `SELECT name, external_reference AS externalReference, website, phone, industry, size, address, lifecycle_status AS lifecycleStatus, tags_json AS tags, description FROM companies WHERE ${companyTerms.join(' AND ')} ORDER BY name COLLATE NOCASE`,
              )
              .all(...companyValues)
          : database
              .prepare(
                `SELECT first_name AS firstName, last_name AS lastName, email, phone, job_title AS jobTitle, status, tags_json AS tags, communication_preference AS communicationPreference FROM contacts WHERE organization_id = ? AND archived_at IS NULL${query.text ? ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)' : ''} ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
              )
              .all(
                session.organizationId,
                ...(query.text ? [`%${query.text}%`, `%${query.text}%`, `%${query.text}%`] : []),
              );
      const columns = Object.keys(
        rows[0] ||
          (resource === 'companies'
            ? {
                name: '',
                externalReference: '',
                website: '',
                phone: '',
                industry: '',
                size: '',
                address: '',
                lifecycleStatus: '',
                tags: '',
                description: '',
              }
            : {
                firstName: '',
                lastName: '',
                email: '',
                phone: '',
                jobTitle: '',
                status: '',
                tags: '',
                communicationPreference: '',
              }),
      );
      const body = [
        columns.join(','),
        ...rows.map((row: any) =>
          columns
            .map((column) =>
              escapeCsv(
                column === 'tags' ? JSON.parse(row[column] || '[]').join('; ') : row[column],
              ),
            )
            .join(','),
        ),
      ].join('\r\n');
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.setHeader('content-disposition', `attachment; filename="${resource}.csv"`);
      return response.send(body);
    } catch (error) {
      return response.status(error instanceof AuthError ? 401 : 400).json({
        error: {
          code: error instanceof AuthError ? 'UNAUTHENTICATED' : 'VALIDATION',
          message: 'Export could not be created.',
        },
      });
    }
  });

  const dealFields =
    'deals.id, deals.company_id AS companyId, deals.owner_id AS ownerId, deals.stage_id AS stageId, deals.name, deals.amount_cents AS amountCents, deals.currency, deals.expected_close_date AS expectedCloseDate, deals.probability, deals.status, deals.loss_reason AS lossReason, deals.created_at AS createdAt, deals.updated_at AS updatedAt, deals.archived_at AS archivedAt, deals.version';
  const dealSession = (request: express.Request) =>
    auth.authenticate(cookieToken(request.headers.cookie));
  const dealError = (error: unknown, response: express.Response) => {
    if (error instanceof AuthError)
      return response
        .status(error.code === 'FORBIDDEN' ? 403 : 401)
        .json({ error: { code: error.code, message: 'You do not have permission to do that.' } });
    if (error instanceof z.ZodError)
      return response
        .status(400)
        .json({ error: { code: 'VALIDATION', message: 'Check the deal fields and try again.' } });
    return response.status(500).json({
      error: { code: 'UNEXPECTED_ERROR', message: 'Something went wrong. Please try again.' },
    });
  };
  app.get('/api/deals', (request, response) => {
    try {
      const s = dealSession(request);
      const query = dealListQuery.parse(request.query);
      const where = ['deals.organization_id = ?'];
      if (!query.includeArchived) where.push('deals.archived_at IS NULL');
      const args: unknown[] = [s.organizationId];
      for (const [key, column] of [
        ['companyId', 'company_id'],
        ['ownerId', 'owner_id'],
        ['stageId', 'stage_id'],
        ['status', 'status'],
      ] as const)
        if (query[key]) {
          where.push(`deals.${column} = ?`);
          args.push(query[key]);
        }
      if (query.text) {
        where.push('deals.name LIKE ?');
        args.push(`%${query.text}%`);
      }
      const clause = where.join(' AND ');
      const total = database
        .prepare(`SELECT count(*) AS total FROM deals WHERE ${clause}`)
        .get(...args).total;
      const aggregates = database
        .prepare(
          `SELECT currency, count(*) AS count, coalesce(sum(amount_cents), 0) AS amountCents FROM deals WHERE ${clause} GROUP BY currency ORDER BY currency`,
        )
        .all(...args);
      const items = database
        .prepare(
          `SELECT ${dealFields}, pipeline_stages.name AS stageName FROM deals JOIN pipeline_stages ON pipeline_stages.id = deals.stage_id AND pipeline_stages.organization_id = deals.organization_id WHERE ${clause} ORDER BY deals.${
            {
              name: 'name COLLATE NOCASE',
              amount: 'amount_cents',
              createdAt: 'created_at',
              updatedAt: 'updated_at',
              expectedCloseDate: 'expected_close_date',
            }[query.sort]
          } ${query.direction.toUpperCase()}, deals.id ASC LIMIT ? OFFSET ?`,
        )
        .all(...args, query.pageSize, (query.page - 1) * query.pageSize);
      return response.json({
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
        aggregates,
      });
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.get('/api/pipeline/stages', (request, response) => {
    try {
      const s = dealSession(request);
      return response.json(
        database
          .prepare(
            'SELECT id, name, position, kind FROM pipeline_stages WHERE organization_id = ? ORDER BY position',
          )
          .all(s.organizationId),
      );
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.post('/api/pipeline/stages', (request, response) => {
    try {
      const s = auth.requireRole(dealSession(request), ['owner']);
      const input = z
        .object({
          name: z.string().trim().min(1).max(120),
          position: z.number().int().nonnegative(),
        })
        .parse(request.body);
      const stage = transaction(() => {
        const now = new Date().toISOString();
        database
          .prepare(
            'UPDATE pipeline_stages SET position = position + 1000 WHERE organization_id = ? AND position >= ?',
          )
          .run(s.organizationId, input.position);
        database
          .prepare(
            'UPDATE pipeline_stages SET position = position - 999 WHERE organization_id = ? AND position >= ?',
          )
          .run(s.organizationId, input.position + 1000);
        const id = `stage_${randomUUID()}`;
        database
          .prepare(
            'INSERT INTO pipeline_stages (id, organization_id, name, position, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(id, s.organizationId, input.name, input.position, 'open', now);
        database
          .prepare(
            'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `aud_${randomUUID()}`,
            s.organizationId,
            s.userId,
            'pipeline.stage_created',
            'pipeline_stage',
            id,
            JSON.stringify({ name: input.name, position: input.position }),
            now,
          );
        return database
          .prepare('SELECT id, name, position, kind FROM pipeline_stages WHERE id = ?')
          .get(id);
      });
      return response.status(201).json(stage);
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.post('/api/deals', (request, response) => {
    try {
      const s = auth.requireRole(dealSession(request), ['owner', 'member']);
      const d = dealInput.parse(request.body);
      if (
        d.ownerId &&
        !database
          .prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?')
          .get(s.organizationId, d.ownerId)
      )
        return response.status(400).json({
          error: {
            code: 'VALIDATION',
            message: 'The deal owner must belong to this organization.',
          },
        });
      const stage = database
        .prepare('SELECT kind FROM pipeline_stages WHERE id = ? AND organization_id = ?')
        .get(d.stageId, s.organizationId);
      if (!stage || stage.kind !== 'open')
        return response
          .status(400)
          .json({ error: { code: 'VALIDATION', message: 'Choose an active pipeline stage.' } });
      const id = `deal_${randomUUID()}`;
      const now = new Date().toISOString();
      transaction(() => {
        database
          .prepare(
            'INSERT INTO deals (id, organization_id, company_id, owner_id, stage_id, name, amount_cents, currency, expected_close_date, probability, status, loss_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            s.organizationId,
            d.companyId,
            d.ownerId || s.userId,
            d.stageId,
            d.name,
            d.amountCents,
            d.currency,
            d.expectedCloseDate || null,
            d.probability,
            'open',
            null,
            now,
            now,
          );
        for (const contactId of d.contactIds)
          database
            .prepare(
              'INSERT INTO deal_contacts (deal_id, contact_id, organization_id) VALUES (?, ?, ?)',
            )
            .run(id, contactId, s.organizationId);
        database
          .prepare(
            'INSERT INTO deal_stage_history (id, organization_id, deal_id, to_stage_id, actor_id, changed_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(`dsh_${randomUUID()}`, s.organizationId, id, d.stageId, s.userId, now);
      });
      return response
        .status(201)
        .json(database.prepare(`SELECT ${dealFields} FROM deals WHERE id = ?`).get(id));
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.get('/api/deals/:id', (request, response) => {
    try {
      const s = dealSession(request);
      const deal = database
        .prepare(
          `SELECT ${dealFields}, pipeline_stages.name AS stageName FROM deals JOIN pipeline_stages ON pipeline_stages.id = deals.stage_id AND pipeline_stages.organization_id = deals.organization_id WHERE deals.id = ? AND deals.organization_id = ?`,
        )
        .get(request.params.id, s.organizationId);
      if (!deal)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This deal was not found.' } });
      return response.json({
        ...deal,
        contacts: database
          .prepare(
            'SELECT contacts.id, contacts.first_name AS firstName, contacts.last_name AS lastName FROM deal_contacts JOIN contacts ON contacts.id = deal_contacts.contact_id WHERE deal_contacts.deal_id = ? AND deal_contacts.organization_id = ?',
          )
          .all(deal.id, s.organizationId),
        history: database
          .prepare(
            'SELECT deal_stage_history.id, from_stage_id AS fromStageId, to_stage_id AS toStageId, actor_id AS actorId, changed_at AS changedAt, reason FROM deal_stage_history WHERE deal_id = ? AND organization_id = ? ORDER BY changed_at DESC',
          )
          .all(deal.id, s.organizationId),
      });
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.patch('/api/deals/:id', (request, response) => {
    try {
      const s = auth.requireRole(dealSession(request), ['owner', 'member']);
      const d = dealUpdate.parse(request.body);
      const now = new Date().toISOString();
      const result = database
        .prepare(
          'UPDATE deals SET company_id = ?, owner_id = ?, name = ?, amount_cents = ?, currency = ?, expected_close_date = ?, probability = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND archived_at IS NULL AND version = ?',
        )
        .run(
          d.companyId,
          d.ownerId || null,
          d.name,
          d.amountCents,
          d.currency,
          d.expectedCloseDate || null,
          d.probability,
          now,
          request.params.id,
          s.organizationId,
          d.version,
        );
      if (!result.changes)
        return response.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'This deal changed or is unavailable. Refresh and try again.',
          },
        });
      database
        .prepare(
          'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          `aud_${randomUUID()}`,
          s.organizationId,
          s.userId,
          'deal.updated',
          'deal',
          request.params.id,
          JSON.stringify({ version: d.version }),
          now,
        );
      return response.json(
        database.prepare(`SELECT ${dealFields} FROM deals WHERE id = ?`).get(request.params.id),
      );
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.post('/api/deals/:id/transition', (request, response) => {
    try {
      const s = auth.requireRole(dealSession(request), ['owner', 'member']);
      const input = z
        .object({
          stageId: z.string().min(1),
          version: z.number().int().positive(),
          lossReason: z.string().trim().min(1).max(500).optional(),
        })
        .parse(request.body);
      const now = new Date().toISOString();
      const changed = transaction(() => {
        const current = database
          .prepare(
            'SELECT stage_id AS stageId, status, version FROM deals WHERE id = ? AND organization_id = ? AND archived_at IS NULL',
          )
          .get(request.params.id, s.organizationId);
        const target = database
          .prepare('SELECT kind FROM pipeline_stages WHERE id = ? AND organization_id = ?')
          .get(input.stageId, s.organizationId);
        if (
          !current ||
          !target ||
          current.version !== input.version ||
          (target.kind === 'lost' && !input.lossReason)
        )
          return null;
        const update = database
          .prepare(
            'UPDATE deals SET stage_id = ?, status = ?, loss_reason = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?',
          )
          .run(
            input.stageId,
            target.kind,
            target.kind === 'lost' ? input.lossReason : null,
            now,
            request.params.id,
            s.organizationId,
            input.version,
          );
        if (!update.changes) return null;
        database
          .prepare(
            'INSERT INTO deal_stage_history (id, organization_id, deal_id, from_stage_id, to_stage_id, actor_id, changed_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `dsh_${randomUUID()}`,
            s.organizationId,
            request.params.id,
            current.stageId,
            input.stageId,
            s.userId,
            now,
            input.lossReason || null,
          );
        database
          .prepare(
            'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `aud_${randomUUID()}`,
            s.organizationId,
            s.userId,
            'deal.transitioned',
            'deal',
            request.params.id,
            JSON.stringify({ fromStageId: current.stageId, toStageId: input.stageId }),
            now,
          );
        return true;
      });
      return changed
        ? response.json(
            database.prepare(`SELECT ${dealFields} FROM deals WHERE id = ?`).get(request.params.id),
          )
        : response.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'The deal changed, stage is invalid, or a loss reason is required.',
            },
          });
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.post('/api/deals/:id/:action', (request, response) => {
    try {
      const s = auth.requireRole(dealSession(request), ['owner', 'member']);
      if (!['archive', 'restore'].includes(request.params.action))
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'That action does not exist.' } });
      const archive = request.params.action === 'archive';
      const now = new Date().toISOString();
      const changed = transaction(() => {
        const result = database
          .prepare(
            `UPDATE deals SET archived_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND archived_at IS ${archive ? 'NULL' : 'NOT NULL'}`,
          )
          .run(archive ? now : null, now, request.params.id, s.organizationId);
        if (result.changes)
          database
            .prepare(
              'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              `aud_${randomUUID()}`,
              s.organizationId,
              s.userId,
              archive ? 'deal.archived' : 'deal.restored',
              'deal',
              request.params.id,
              '{}',
              now,
            );
        return result.changes;
      });
      return changed
        ? response.status(204).end()
        : response.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'The deal is already in that state or unavailable.',
            },
          });
    } catch (error) {
      return dealError(error, response);
    }
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'That API endpoint does not exist.' },
    });
  });

  return app;
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(
    'Unhandled request error',
    error instanceof Error ? error.message : 'unknown error',
  );
  response.status(500).json({
    error: {
      code: 'UNEXPECTED_ERROR',
      message: 'Something unexpected happened. Please try again.',
    },
  });
};
