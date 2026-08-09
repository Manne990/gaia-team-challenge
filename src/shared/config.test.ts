import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadRuntimeConfig } from './config.js';

describe('loadConfig', () => {
  it('uses safe local defaults and resolves the database from the cwd', () => {
    expect(loadConfig({}, '/workspace')).toEqual({
      host: '127.0.0.1',
      port: 4173,
      databasePath: path.resolve('/workspace/data/northstar.sqlite'),
      environment: 'development',
    });
  });

  it('rejects invalid ports with an actionable error', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow('Invalid configuration');
  });

  it('allows command-line host, port, and database-path overrides', () => {
    expect(
      loadRuntimeConfig(
        ['--host', '0.0.0.0', '--port', '5000', '--db-path', 'tmp/a.sqlite'],
        {},
        '/workspace',
      ),
    ).toEqual({
      host: '0.0.0.0',
      port: 5000,
      databasePath: path.resolve('/workspace/tmp/a.sqlite'),
      environment: 'development',
    });
  });
});
