import { TaskError, type TaskActor, type TaskInput, TaskService } from './tasks.js';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function failure(error: unknown) {
  if (error instanceof TaskError)
    return json(
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 422,
      { error: { code: error.code, message: error.message } },
    );
  return json(500, {
    error: { code: 'UNEXPECTED', message: 'Something went wrong. Please try again.' },
  });
}
export async function handleTaskRequest(
  request: Request,
  actor: TaskActor | null,
  service: TaskService,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/tasks')) return null;
  if (!actor)
    return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
  try {
    const suffix = url.pathname.slice('/api/tasks'.length);
    if (!suffix && request.method === 'GET')
      return json(200, {
        items: service.list(actor, url.searchParams.get('view') ?? 'all', undefined, {
          companyId: url.searchParams.get('companyId') ?? undefined,
          contactId: url.searchParams.get('contactId') ?? undefined,
          dealId: url.searchParams.get('dealId') ?? undefined,
        }),
        displayTimezone: 'UTC',
      });
    if (!suffix && request.method === 'POST')
      return json(201, service.create(actor, (await request.json()) as TaskInput));
    const match = suffix.match(/^\/([^/]+)(?:\/(archive|restore))?$/);
    if (!match) return json(404, { error: { code: 'NOT_FOUND', message: 'Task not found.' } });
    const [, id, action] = match;
    if (!action && request.method === 'GET') return json(200, service.get(actor, id));
    const payload = (await request.json()) as TaskInput & { version?: unknown };
    if (typeof payload.version !== 'number' || !Number.isInteger(payload.version))
      throw new TaskError('VALIDATION', 'A task version is required.');
    if (!action && request.method === 'PUT')
      return json(200, service.update(actor, id, payload, payload.version));
    if (action && request.method === 'POST')
      return json(200, service.archive(actor, id, payload.version, action === 'restore'));
    return json(405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'This action is not supported.' },
    });
  } catch (error) {
    return failure(error);
  }
}
