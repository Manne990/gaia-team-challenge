import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('deals API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });
  it('creates, scopes, and transitions deals with durable history', async () => {
    environment = await createTemporaryEnvironment();
    const db = openDatabase(environment.databasePath);
    seedDatabase(db);
    db.close();
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const cookie = (
      await fetch(`${url}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@northstar.test', password: 'OwnerPass!2026' }),
      })
    ).headers.get('set-cookie');
    const insertedStage = await fetch(`${url}/api/pipeline/stages`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Discovery', position: 1 }),
    });
    expect(insertedStage.status).toBe(201);
    const stages = await (
      await fetch(`${url}/api/pipeline/stages`, { headers: { cookie } })
    ).json();
    expect(stages.map((stage) => stage.position)).toEqual(stages.map((_stage, index) => index));
    const created = await fetch(`${url}/api/deals`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'New pipeline deal',
        companyId: 'co_acme',
        stageId: 'stage_proposal',
        amountCents: 42000,
        currency: 'USD',
        probability: 40,
        contactIds: ['ct_ada'],
      }),
    });
    expect(created.status).toBe(201);
    const deal = await created.json();
    expect((await fetch(`${url}/api/deals`, { headers: { cookie } })).status).toBe(200);
    const filtered = await (
      await fetch(`${url}/api/deals?stageId=stage_proposal&status=open`, { headers: { cookie } })
    ).json();
    expect(
      filtered.items.every((item) => item.stageId === 'stage_proposal' && item.status === 'open'),
    ).toBe(true);
    expect(filtered.aggregate.count).toBe(filtered.total);
    expect(filtered.aggregate.amountCents).toBeGreaterThanOrEqual(42000);
    expect((await fetch(`${url}/api/deals/${deal.id}`, { headers: { cookie } })).status).toBe(200);
    const rejected = await fetch(`${url}/api/deals/${deal.id}/transition`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'stage_lost', version: deal.version }),
    });
    expect(rejected.status).toBe(409);
    const moved = await fetch(`${url}/api/deals/${deal.id}/transition`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'stage_won', version: deal.version }),
    });
    expect(moved.status).toBe(200);
    const movedDeal = await moved.json();
    expect(
      (
        await fetch(`${url}/api/deals/${deal.id}`, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Renamed pipeline deal',
            companyId: 'co_acme',
            amountCents: 43000,
            currency: 'USD',
            probability: 100,
            version: movedDeal.version,
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await fetch(`${url}/api/deals/${deal.id}`, { headers: { cookie } })).json()).history,
    ).toHaveLength(2);
    expect(
      (await fetch(`${url}/api/deals/${deal.id}/archive`, { method: 'POST', headers: { cookie } }))
        .status,
    ).toBe(204);
    expect(
      (await fetch(`${url}/api/deals/${deal.id}/restore`, { method: 'POST', headers: { cookie } }))
        .status,
    ).toBe(204);
    const viewerCookie = (
      await fetch(`${url}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'viewer@northstar.test', password: 'ViewerPass!2026' }),
      })
    ).headers.get('set-cookie');
    expect(
      (
        await fetch(`${url}/api/deals`, {
          method: 'POST',
          headers: { cookie: viewerCookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Blocked',
            companyId: 'co_acme',
            stageId: 'stage_proposal',
            amountCents: 1,
          }),
        })
      ).status,
    ).toBe(403);
    const outsideCookie = (
      await fetch(`${url}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'other-owner@outside.test', password: 'OutsidePass!2026' }),
      })
    ).headers.get('set-cookie');
    expect(
      (await fetch(`${url}/api/deals/${deal.id}`, { headers: { cookie: outsideCookie } })).status,
    ).toBe(404);
  });
});
