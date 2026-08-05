import { resolve } from 'node:path';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readPort(value: string | undefined): number {
  if (value === undefined) return 4173;
  if (!/^\d+$/.test(value))
    throw new Error('NORTHSTAR_PORT must be an integer between 1 and 65535.');
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error('NORTHSTAR_PORT must be between 1 and 65535.');
  return port;
}
export const config = {
  host: argument('--host') ?? process.env.NORTHSTAR_HOST ?? '127.0.0.1',
  port: readPort(argument('--port') ?? process.env.NORTHSTAR_PORT),
  databasePath: resolve(process.env.NORTHSTAR_DB_PATH ?? './.data/northstar.sqlite'),
};
