import type { ContactActor } from './contacts.js';
import { CsvImportService, type ImportResource, renderCsv } from './csv.js';

function json(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function handleCsvRequest(
  request: Request,
  actor: ContactActor | null,
  service: CsvImportService,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/imports')) return null;
  if (!actor)
    return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
  if (actor.role === 'viewer')
    return json(403, { error: { code: 'FORBIDDEN', message: 'Viewer access is read only.' } });
  try {
    if (url.pathname === '/api/imports/preview' && request.method === 'POST') {
      const payload = (await request.json()) as {
        resource?: ImportResource;
        filename?: string;
        csv?: string;
      };
      if (
        (payload.resource !== 'companies' && payload.resource !== 'contacts') ||
        typeof payload.csv !== 'string' ||
        typeof payload.filename !== 'string'
      )
        throw new Error('Enter a company or contact CSV file.');
      return json(
        201,
        service.createPreview(
          actor.organizationId,
          actor.membershipId,
          payload.resource,
          payload.filename,
          payload.csv,
        ),
      );
    }
    const commit = url.pathname.match(/^\/api\/imports\/([^/]+)\/commit$/);
    if (commit && request.method === 'POST') {
      service.commit(actor.organizationId, commit[1]!);
      return json(200, { ok: true });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: 'Import was not found.' } });
  } catch (error) {
    return json(422, {
      error: {
        code: 'VALIDATION',
        message: error instanceof Error ? error.message : 'Import could not be processed.',
      },
    });
  }
}

export function csvDownload(columns: string[], rows: Record<string, unknown>[]) {
  return new Response(renderCsv(columns, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="northstar-export.csv"',
      'cache-control': 'no-store',
    },
  });
}
