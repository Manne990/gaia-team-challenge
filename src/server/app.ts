import { type IncomingMessage, type ServerResponse } from 'node:http';
import { openDatabase } from './database.js';
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
export function handleApi(request: IncomingMessage, response: ServerResponse): boolean {
  if (!request.url?.startsWith('/api/')) return false;
  if (request.method === 'GET' && request.url === '/api/health') {
    try {
      const database = openDatabase();
      database.prepare('SELECT 1').get();
      database.close();
      sendJson(response, 200, { status: 'ok' });
    } catch {
      sendJson(response, 503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Northstar CRM is temporarily unavailable. Please try again shortly.',
        },
      });
    }
  } else
    sendJson(response, 404, {
      error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
    });
  return true;
}
