import express, { type ErrorRequestHandler } from 'express';
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { AppConfig } from '../shared/config.js';

const require = createRequire(import.meta.url);
const { openDatabase, migrate } = require('../db/database.mjs') as {
  openDatabase(path: string): unknown;
  migrate(database: unknown): void;
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
      return response
        .status(200)
        .json({ user: session.user, organizationId: session.organizationId, role: session.role });
    } catch (error) {
      return response.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      });
    }
  });
  app.get('/api/auth/session', (request, response) => {
    try {
      return response.json(auth.authenticate(cookieToken(request.headers.cookie)));
    } catch {
      return response
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
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
