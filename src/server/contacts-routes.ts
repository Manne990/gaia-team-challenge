import { ContactError, type ContactActor, type ContactInput, ContactService } from './contacts.js';

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function error(error: unknown) {
  if (error instanceof ContactError) {
    const status =
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 422;
    return response(status, { error: { code: error.code, message: error.message } });
  }
  return response(500, {
    error: { code: 'UNEXPECTED', message: 'Something went wrong. Please try again.' },
  });
}

async function body(request: Request): Promise<ContactInput> {
  try {
    return (await request.json()) as ContactInput;
  } catch {
    throw new ContactError('VALIDATION', 'Enter valid contact details.');
  }
}

export async function handleContactRequest(
  request: Request,
  actor: ContactActor | null,
  service: ContactService,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/contacts')) return null;
  if (!actor)
    return response(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
  try {
    const suffix = url.pathname.slice('/api/contacts'.length);
    if (suffix === '' && request.method === 'GET')
      return response(
        200,
        service.list(actor, {
          page: Number(url.searchParams.get('page') ?? 1),
          pageSize: Number(url.searchParams.get('pageSize') ?? 25),
          sort: (url.searchParams.get('sort') ?? 'name') as 'name' | 'email' | 'updatedAt',
          direction: (url.searchParams.get('direction') ?? 'asc') as 'asc' | 'desc',
          companyId: url.searchParams.get('companyId') ?? undefined,
          ownerMembershipId: url.searchParams.get('ownerMembershipId') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          tag: url.searchParams.get('tag') ?? undefined,
          text: url.searchParams.get('text') ?? undefined,
          includeArchived: url.searchParams.get('includeArchived') === 'true',
        }),
      );
    if (suffix === '' && request.method === 'POST')
      return response(201, service.create(actor, await body(request)));
    const match = suffix.match(/^\/([^/]+)(?:\/(archive|restore))?$/);
    if (!match)
      return response(404, { error: { code: 'NOT_FOUND', message: 'Contact not found.' } });
    const [, id, action] = match;
    if (!action && request.method === 'GET') return response(200, service.get(actor, id));
    if (!action && request.method === 'PUT') {
      const payload = (await request.json()) as ContactInput & { version?: unknown };
      if (typeof payload.version !== 'number' || !Number.isInteger(payload.version))
        throw new ContactError('VALIDATION', 'A contact version is required.');
      return response(200, service.update(actor, id, payload, payload.version));
    }
    if (action && request.method === 'POST') {
      const payload = (await request.json()) as { version?: unknown };
      if (typeof payload.version !== 'number' || !Number.isInteger(payload.version))
        throw new ContactError('VALIDATION', 'A contact version is required.');
      return response(
        200,
        action === 'archive'
          ? service.archive(actor, id, payload.version)
          : service.restore(actor, id, payload.version),
      );
    }
    return response(405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'This action is not supported.' },
    });
  } catch (caught) {
    return error(caught);
  }
}
