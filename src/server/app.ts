import { createHash, randomBytes } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { compareSync } from 'bcryptjs';
import { openDatabase } from './database.js';
import {
  CompanyError,
  archiveCompany,
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  type CompanyInput,
} from './companies.js';
import { ActivityError, ActivityService, type ActivityInput } from './activities.js';
import { dashboard } from './dashboard.js';
import { TaskError, TaskService, type TaskInput } from './tasks.js';
import { ContactError, ContactService, type ContactInput } from './contacts.js';
import { DealError, DealService, type DealInput } from './deals.js';
import { SearchError, SearchService, type SearchResource } from './search.js';
import { NotificationError, NotificationService } from './notifications.js';
import { DuplicateError, DuplicateService, type DuplicateResource } from './duplicates.js';
import { CsvImportService, renderCsv, type ImportResource } from './csv.js';
import { listAudit } from './audit.js';
import { AdministrationError, AdministrationService } from './administration.js';
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
function cookie(request: IncomingMessage) {
  return request.headers.cookie
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('northstar_session='))
    ?.slice(18);
}
function actor(request: IncomingMessage, db: ReturnType<typeof openDatabase>) {
  const token = cookie(request);
  if (!token) return null;
  return db
    .prepare(
      'SELECT m.organization_id,m.id AS membership_id,m.role,u.id AS user_id,u.display_name,o.name AS organization_name FROM sessions s JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.user_id JOIN users u ON u.id=s.user_id JOIN organizations o ON o.id=m.organization_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > ?',
    )
    .get(tokenHash(token), new Date().toISOString()) as
    | {
        organization_id: string;
        membership_id: string;
        role: string;
        organization_name: string;
        display_name: string;
      }
    | undefined;
}
function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) reject(new Error('too large'));
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid'));
      }
    });
    request.on('error', reject);
  });
}
function fail(response: ServerResponse, error: unknown) {
  if (error instanceof CompanyError)
    return sendJson(response, error.status, {
      error: { code: error.code, message: error.message },
    });
  if (error instanceof ActivityError)
    return sendJson(
      response,
      error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 422,
      {
        error: { code: error.code, message: error.message },
      },
    );
  if (error instanceof TaskError)
    return sendJson(
      response,
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 422,
      { error: { code: error.code, message: error.message } },
    );
  if (error instanceof ContactError)
    return sendJson(
      response,
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 422,
      { error: { code: error.code, message: error.message } },
    );
  if (error instanceof DealError || error instanceof DuplicateError)
    return sendJson(
      response,
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 422,
      { error: { code: error.code, message: error.message } },
    );
  if (error instanceof SearchError)
    return sendJson(response, error.code === 'NOT_FOUND' ? 404 : 422, {
      error: { code: error.code, message: error.message },
    });
  if (error instanceof NotificationError)
    return sendJson(response, error.code === 'NOT_FOUND' ? 404 : 403, {
      error: { code: error.code, message: error.message },
    });
  if (error instanceof AdministrationError)
    return sendJson(
      response,
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 422,
      { error: { code: error.code, message: error.message } },
    );
  return sendJson(response, 500, {
    error: { code: 'UNEXPECTED', message: 'Something went wrong. Please try again.' },
  });
}
function requireActor(
  request: IncomingMessage,
  response: ServerResponse,
  db: ReturnType<typeof openDatabase>,
) {
  const value = actor(request, db);
  if (!value) {
    sendJson(response, 401, {
      error: { code: 'UNAUTHORIZED', message: 'Please sign in to continue.' },
    });
    return null;
  }
  return value;
}
export function handleApi(request: IncomingMessage, response: ServerResponse): boolean {
  if (!request.url?.startsWith('/api/')) return false;
  const url = new URL(request.url, 'http://northstar.local');
  if (url.pathname === '/api/health') {
    try {
      const db = openDatabase();
      db.prepare('SELECT 1').get();
      db.close();
      sendJson(response, 200, { status: 'ok' });
    } catch {
      sendJson(response, 503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Northstar CRM is temporarily unavailable. Please try again shortly.',
        },
      });
    }
    return true;
  }
  if (url.pathname === '/api/auth/sign-in' && request.method === 'POST') {
    void body(request)
      .then((data) => {
        const value = data as { email?: string; password?: string };
        const db = openDatabase();
        try {
          const user = db
            .prepare('SELECT * FROM users WHERE email=?')
            .get(value.email?.trim().toLowerCase()) as
            { id: string; password_hash: string } | undefined;
          const membership =
            user && compareSync(value.password ?? '', user.password_hash)
              ? (db.prepare('SELECT * FROM memberships WHERE user_id=?').get(user.id) as
                  { organization_id: string } | undefined)
              : undefined;
          if (!membership)
            return sendJson(response, 401, {
              error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
            });
          const token = randomBytes(32).toString('base64url'),
            now = new Date(),
            expires = new Date(now.getTime() + 604800000);
          db.prepare(
            'INSERT INTO sessions (id,organization_id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)',
          ).run(
            randomBytes(16).toString('hex'),
            membership.organization_id,
            user!.id,
            tokenHash(token),
            expires.toISOString(),
            now.toISOString(),
          );
          response.setHeader(
            'Set-Cookie',
            `northstar_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
          );
          sendJson(response, 200, { ok: true });
        } finally {
          db.close();
        }
      })
      .catch((error) => fail(response, error));
    return true;
  }
  if (url.pathname === '/api/auth/sign-out' && request.method === 'POST') {
    const db = openDatabase();
    const token = cookie(request);
    if (token)
      db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(
        new Date().toISOString(),
        tokenHash(token),
      );
    db.close();
    response.setHeader(
      'Set-Cookie',
      'northstar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const db = openDatabase();
    try {
      const current = actor(request, db);
      if (current)
        sendJson(response, 200, {
          authenticated: true,
          organizationId: current.organization_id,
          membershipId: current.membership_id,
          role: current.role,
          organizationName: current.organization_name,
          displayName: current.display_name,
        });
      else sendJson(response, 200, { authenticated: false });
    } finally {
      db.close();
    }
    return true;
  }
  const db = openDatabase();
  const current = requireActor(request, response, db);
  if (!current) {
    db.close();
    return true;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[2];
  let deferred = false;
  try {
    if (url.pathname === '/api/exports/companies' && request.method === 'GET') {
      const items = listCompanies(db, current.organization_id, url.searchParams).items as Record<
        string,
        unknown
      >[];
      response.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="companies.csv"',
        'cache-control': 'no-store',
      });
      response.end(
        renderCsv(
          ['name', 'external_reference', 'website', 'phone', 'industry', 'lifecycle_status'],
          items,
        ),
      );
    } else if (url.pathname === '/api/exports/contacts' && request.method === 'GET') {
      const items = new ContactService(db).list(
        {
          organizationId: current.organization_id,
          membershipId: current.membership_id,
          role: current.role as 'owner' | 'member' | 'viewer',
        },
        { pageSize: 100, text: url.searchParams.get('q') ?? undefined },
      ).items as Record<string, unknown>[];
      response.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="contacts.csv"',
        'cache-control': 'no-store',
      });
      response.end(
        renderCsv(['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'status'], items),
      );
    } else if (url.pathname === '/api/imports/preview' && request.method === 'POST') {
      if (current.role === 'viewer')
        throw new CompanyError('FORBIDDEN', 'Viewer access is read only.', 403);
      deferred = true;
      void body(request).then((data) => {
        try {
          const value = data as { resource?: ImportResource; filename?: string; csv?: string };
          if (typeof value.filename !== 'string' || typeof value.csv !== 'string')
            throw new CompanyError('VALIDATION', 'Enter a CSV file.', 422);
          if (value.resource !== 'companies' && value.resource !== 'contacts')
            throw new CompanyError('VALIDATION', 'Choose companies or contacts.', 422);
          sendJson(
            response,
            201,
            new CsvImportService(db).createPreview(
              current.organization_id,
              current.membership_id,
              value.resource,
              value.filename,
              value.csv,
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (id && parts[1] === 'imports' && parts[3] === 'commit' && request.method === 'POST') {
      if (current.role === 'viewer')
        throw new CompanyError('FORBIDDEN', 'Viewer access is read only.', 403);
      new CsvImportService(db).commit(current.organization_id, id);
      sendJson(response, 200, { ok: true });
    } else if (url.pathname === '/api/dashboard' && request.method === 'GET')
      sendJson(
        response,
        200,
        dashboard(db, {
          organizationId: current.organization_id,
          membershipId: current.membership_id,
          role: current.role as 'owner' | 'member' | 'viewer',
        }),
      );
    else if (url.pathname === '/api/tasks' && request.method === 'GET')
      sendJson(response, 200, {
        items: new TaskService(db).list(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          url.searchParams.get('view') ?? 'all',
        ),
        displayTimezone: 'UTC',
        actorMembershipId: current.membership_id,
      });
    else if (url.pathname === '/api/tasks' && request.method === 'POST') {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(
            response,
            201,
            new TaskService(db).create(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              data as TaskInput,
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (id && url.pathname.startsWith('/api/tasks/') && request.method === 'PUT') {
      deferred = true;
      void body(request).then((data) => {
        try {
          const input = data as TaskInput & { version?: unknown };
          if (typeof input.version !== 'number' || !Number.isInteger(input.version))
            throw new TaskError('VALIDATION', 'A task version is required.');
          sendJson(
            response,
            200,
            new TaskService(db).update(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              id,
              input,
              input.version,
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (url.pathname === '/api/contacts' && request.method === 'GET')
      sendJson(
        response,
        200,
        new ContactService(db).list(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          {
            text: url.searchParams.get('text') ?? undefined,
            page: Number(url.searchParams.get('page') ?? 1),
            pageSize: Number(url.searchParams.get('pageSize') ?? 25),
            sort: (url.searchParams.get('sort') ?? 'name') as 'name' | 'email' | 'updatedAt',
            direction: (url.searchParams.get('direction') ?? 'asc') as 'asc' | 'desc',
            companyId: url.searchParams.get('companyId') ?? undefined,
            ownerMembershipId: url.searchParams.get('ownerMembershipId') ?? undefined,
            status: url.searchParams.get('status') ?? undefined,
            tag: url.searchParams.get('tag') ?? undefined,
            includeArchived: url.searchParams.get('includeArchived') === 'true',
          },
        ),
      );
    else if (url.pathname === '/api/contacts' && request.method === 'POST') {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(
            response,
            201,
            new ContactService(db).create(current as never, data as ContactInput),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (id && url.pathname.startsWith('/api/contacts/') && request.method === 'GET')
      sendJson(response, 200, new ContactService(db).get(current as never, id));
    else if (id && url.pathname.startsWith('/api/contacts/') && request.method === 'PUT') {
      deferred = true;
      void body(request).then((data) => {
        try {
          const input = data as ContactInput & { version?: unknown };
          if (typeof input.version !== 'number' || !Number.isInteger(input.version))
            throw new ContactError('VALIDATION', 'A contact version is required.');
          sendJson(
            response,
            200,
            new ContactService(db).update(current as never, id, input, input.version),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (
      id &&
      url.pathname.startsWith('/api/contacts/') &&
      ['archive', 'restore'].includes(parts[3] ?? '') &&
      request.method === 'POST'
    ) {
      deferred = true;
      void body(request).then((data) => {
        try {
          const version = (data as { version?: unknown }).version;
          if (typeof version !== 'number' || !Number.isInteger(version))
            throw new ContactError('VALIDATION', 'A contact version is required.');
          const service = new ContactService(db);
          sendJson(
            response,
            200,
            parts[3] === 'archive'
              ? service.archive(current as never, id, version)
              : service.restore(current as never, id, version),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (url.pathname === '/api/deals' && request.method === 'GET')
      sendJson(
        response,
        200,
        new DealService(db).list(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          {
            stageId: url.searchParams.get('stageId') ?? undefined,
            status: url.searchParams.get('status') ?? undefined,
            companyId: url.searchParams.get('companyId') ?? undefined,
            text: url.searchParams.get('text') ?? undefined,
            includeArchived: url.searchParams.get('includeArchived') === 'true',
          },
        ),
      );
    else if (url.pathname === '/api/deals' && request.method === 'POST') {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(
            response,
            201,
            new DealService(db).create(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              data as DealInput,
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (
      id &&
      url.pathname.startsWith('/api/deals/') &&
      parts[3] === 'transition' &&
      request.method === 'POST'
    ) {
      deferred = true;
      void body(request).then((data) => {
        try {
          const input = data as { version?: unknown; stageId?: unknown; lossReason?: unknown };
          if (typeof input.version !== 'number' || typeof input.stageId !== 'string')
            throw new DealError('VALIDATION', 'A deal version and stage are required.');
          sendJson(
            response,
            200,
            new DealService(db).transition(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              id,
              input.version,
              input.stageId,
              typeof input.lossReason === 'string' ? input.lossReason : null,
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (url.pathname === '/api/search' && request.method === 'GET')
      sendJson(
        response,
        200,
        new SearchService(db).search(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          url.searchParams.get('q') ?? url.searchParams.get('text') ?? '',
          Number(url.searchParams.get('limit') ?? 10),
        ),
      );
    else if (
      (url.pathname === '/api/search/views' || url.pathname === '/api/views') &&
      request.method === 'POST'
    ) {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(
            response,
            201,
            new SearchService(db).save(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              data as {
                id?: string;
                name: string;
                resource: SearchResource;
                query: unknown;
                version?: number;
              },
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (url.pathname === '/api/notifications' && request.method === 'GET')
      sendJson(response, 200, {
        items: new NotificationService(db).list(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          url.searchParams.get('unread') === 'true',
        ),
      });
    else if (url.pathname === '/api/notifications/read-all' && request.method === 'POST')
      sendJson(response, 200, {
        updated: new NotificationService(db).markAllRead({
          organizationId: current.organization_id,
          membershipId: current.membership_id,
          role: current.role as 'owner' | 'member' | 'viewer',
        }),
      });
    else if (
      id &&
      url.pathname.startsWith('/api/notifications/') &&
      parts[3] === 'read' &&
      request.method === 'POST'
    ) {
      new NotificationService(db).markRead(
        {
          organizationId: current.organization_id,
          membershipId: current.membership_id,
          role: current.role as 'owner' | 'member' | 'viewer',
        },
        id,
      );
      sendJson(response, 200, { ok: true });
    } else if (url.pathname === '/api/duplicates' && request.method === 'GET') {
      const resource = url.searchParams.get('resource');
      const duplicateId = url.searchParams.get('id');
      if (!resource || !duplicateId) sendJson(response, 200, { items: [] });
      else if (resource !== 'company' && resource !== 'contact')
        throw new DuplicateError('VALIDATION', 'Choose a valid CRM resource.');
      else
        sendJson(response, 200, {
          items: new DuplicateService(db).candidates(
            {
              organizationId: current.organization_id,
              membershipId: current.membership_id,
              role: current.role as 'owner' | 'member' | 'viewer',
            },
            resource as DuplicateResource,
            duplicateId,
          ),
        });
    } else if (url.pathname === '/api/duplicates/merge' && request.method === 'POST') {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(
            response,
            200,
            new DuplicateService(db).merge(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              data as never,
            ),
          );
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (url.pathname === '/api/audit' && request.method === 'GET')
      sendJson(
        response,
        200,
        listAudit(
          db,
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          url.searchParams,
        ),
      );
    else if (url.pathname === '/api/admin/members' && request.method === 'GET')
      sendJson(response, 200, {
        items: new AdministrationService(db).list({
          organizationId: current.organization_id,
          membershipId: current.membership_id,
          role: current.role as 'owner' | 'member' | 'viewer',
        }),
      });
    else if (url.pathname === '/api/admin/members' && request.method === 'POST') {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(response, 201, {
            member: new AdministrationService(db).invite(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              data as { email: string; displayName?: string; password: string; role: string },
            ),
          });
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (url.pathname === '/api/activities' && request.method === 'GET')
      sendJson(
        response,
        200,
        new ActivityService(db).list(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          {
            page: Number(url.searchParams.get('page') ?? 1),
            pageSize: Number(url.searchParams.get('pageSize') ?? 25),
            type: url.searchParams.get('type') ?? undefined,
            author: url.searchParams.get('author') ?? undefined,
            companyId: url.searchParams.get('companyId') ?? undefined,
            contactId: url.searchParams.get('contactId') ?? undefined,
            from: url.searchParams.get('from') ?? undefined,
            to: url.searchParams.get('to') ?? undefined,
          },
        ),
      );
    else if (url.pathname === '/api/activities' && request.method === 'POST') {
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(response, 201, {
            activity: new ActivityService(db).create(
              {
                organizationId: current.organization_id,
                membershipId: current.membership_id,
                role: current.role as 'owner' | 'member' | 'viewer',
              },
              data as ActivityInput,
            ),
          });
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (id && url.pathname.startsWith('/api/activities/') && request.method === 'GET')
      sendJson(response, 200, {
        activity: new ActivityService(db).get(
          {
            organizationId: current.organization_id,
            membershipId: current.membership_id,
            role: current.role as 'owner' | 'member' | 'viewer',
          },
          id,
        ),
      });
    else if (url.pathname === '/api/companies' && request.method === 'GET')
      sendJson(response, 200, listCompanies(db, current.organization_id, url.searchParams));
    else if (url.pathname === '/api/companies' && request.method === 'POST') {
      if (current.role === 'viewer')
        throw new CompanyError('FORBIDDEN', 'Viewer access is read only.', 403);
      deferred = true;
      void body(request).then((data) => {
        try {
          sendJson(response, 201, {
            company: createCompany(
              db,
              current.organization_id,
              current.membership_id,
              data as CompanyInput,
            ),
          });
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (id && request.method === 'GET')
      sendJson(response, 200, getCompany(db, current.organization_id, id));
    else if (id && request.method === 'PUT') {
      if (current.role === 'viewer')
        throw new CompanyError('FORBIDDEN', 'Viewer access is read only.', 403);
      deferred = true;
      void body(request).then((data) => {
        try {
          const input = data as CompanyInput & { version: number };
          sendJson(response, 200, {
            company: updateCompany(db, current.organization_id, id, input, input.version),
          });
        } catch (error) {
          fail(response, error);
        } finally {
          db.close();
        }
      });
      return true;
    } else if (
      id &&
      (request.method === 'DELETE' || (request.method === 'POST' && parts[3] === 'restore'))
    ) {
      if (current.role === 'viewer')
        throw new CompanyError('FORBIDDEN', 'Viewer access is read only.', 403);
      sendJson(response, 200, {
        company: archiveCompany(db, current.organization_id, id, request.method === 'POST'),
      });
    } else
      sendJson(response, 404, {
        error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
      });
  } catch (error) {
    fail(response, error);
  } finally {
    if (!deferred) db.close();
  }
  return true;
}
