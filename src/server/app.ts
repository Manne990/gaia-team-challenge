import express, { type ErrorRequestHandler } from 'express';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../shared/config.js';

const require = createRequire(import.meta.url);
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
          ? 'created_at DESC'
          : sort === 'updatedAt'
            ? 'updated_at DESC'
            : sort === 'email'
              ? 'email COLLATE NOCASE'
              : 'last_name COLLATE NOCASE, first_name COLLATE NOCASE';
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
                'SELECT id, type, subject, occurred_at AS occurredAt FROM activities WHERE organization_id = ? AND contact_id = ? ORDER BY occurred_at DESC',
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
      const result = transaction(() => {
        const result = database
          .prepare(
            `UPDATE contacts SET company_id=?, first_name=?, last_name=?, email=?, phone=?, job_title=?, owner_id=?, status=?, tags_json=?, communication_preference=?, updated_at=?, version=version+1 WHERE id=? AND organization_id=? AND archived_at IS NULL AND version = ?`,
          )
          .run(
            c.companyId || null,
            c.firstName,
            c.lastName,
            c.email ? c.email.toLowerCase() : null,
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
      return response.json(
        database
          .prepare(`SELECT ${contactFields} FROM contacts WHERE id = ?`)
          .get(request.params.id),
      );
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
      const result = transaction(() => {
        const result = database
          .prepare(
            'UPDATE contacts SET archived_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ?',
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
      return result.changes
        ? response.status(204).end()
        : response
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
    } catch (e) {
      return sendContactError(e, response);
    }
  });

  app.get('/api/companies/:id', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const company = database
        .prepare('SELECT id, name FROM companies WHERE id = ? AND organization_id = ?')
        .get(request.params.id, session.organizationId);
      if (!company)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
      return response.json(company);
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
        .prepare('SELECT id FROM companies WHERE id = ? AND organization_id = ?')
        .get(request.params.id, session.organizationId);
      if (!company)
        return response
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'This record was not found.' } });
      return response.status(409).json({
        error: { code: 'NOT_IMPLEMENTED', message: 'Company editing is not available yet.' },
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
