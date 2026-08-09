import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const environmentSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4173),
  CRM_DB_PATH: z.string().trim().min(1).default('data/northstar.sqlite'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = Readonly<{
  host: string;
  port: number;
  databasePath: string;
  environment: 'development' | 'test' | 'production';
}>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(result.error)}`);
  }

  const databasePath = path.resolve(cwd, result.data.CRM_DB_PATH);
  if (databasePath === path.parse(databasePath).root) {
    throw new Error('Invalid configuration: CRM_DB_PATH must name a database file.');
  }

  return {
    host: result.data.HOST,
    port: result.data.PORT,
    databasePath,
    environment: result.data.NODE_ENV,
  };
}

export function loadRuntimeConfig(
  args = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const parsed = parseArgs({
    args,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'db-path': { type: 'string' },
    },
    strict: true,
  });
  return loadConfig(
    {
      ...environment,
      HOST: parsed.values.host ?? environment.HOST,
      PORT: parsed.values.port ?? environment.PORT,
      CRM_DB_PATH: parsed.values['db-path'] ?? environment.CRM_DB_PATH,
    },
    cwd,
  );
}
