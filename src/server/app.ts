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

  app.get('/api/companies', (request, response) => {
    try {
      const session = auth.authenticate(cookieToken(request.headers.cookie));
      const query = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
          text: z.string().trim().optional(),
          lifecycle: z.enum(['lead', 'prospect', 'customer', 'inactive']).optional(),
        })
        .parse(request.query);
      const terms = ['organization_id = ?'];
      const values: unknown[] = [session.organizationId];
      if (query.text) {
        terms.push('(name LIKE ? OR external_reference LIKE ?)');
        values.push(`%${query.text}%`, `%${query.text}%`);
      }
      if (query.lifecycle) {
        terms.push('lifecycle_status = ?');
        values.push(query.lifecycle);
      }
      const where = terms.join(' AND ');
      const total = database
        .prepare(`SELECT count(*) AS total FROM companies WHERE ${where}`)
        .get(...values).total;
      const rows = database
        .prepare(
          `SELECT * FROM companies WHERE ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
        )
        .all(...values, query.pageSize, (query.page - 1) * query.pageSize);
      return response.json({ items: rows, page: query.page, pageSize: query.pageSize, total });
    } catch {
      return response
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
    }
  });
  app.post('/api/companies', (request, response) => {
    try {
      const session = auth.requireRole(auth.authenticate(cookieToken(request.headers.cookie)), [
        'owner',
        'member',
      ]);
      const input = companyInput.parse(request.body);
      const now = new Date().toISOString();
      const id = `co_${randomUUID()}`;
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
          session.userId,
          JSON.stringify(input.tags),
          input.description,
          now,
          now,
        );
      return response
        .status(201)
        .json(database.prepare('SELECT * FROM companies WHERE id = ?').get(id));
    } catch (error) {
      if (error instanceof AuthError && error.code === 'FORBIDDEN')
        return response
          .status(403)
          .json({
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have permission to perform this action.',
            },
          });
      if (String(error).includes('UNIQUE constraint failed'))
        return response
          .status(409)
          .json({
            error: { code: 'CONFLICT', message: 'A company already uses this external reference.' },
          });
      return response
        .status(400)
        .json({
          error: { code: 'VALIDATION', message: 'Check the company fields and try again.' },
        });
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
