import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('dashboard API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });

  it('derives tenant-scoped metrics and reconciles their record filters', async () => {
    environment = await createTemporaryEnvironment();
    const db = openDatabase(environment.databasePath);
    seedDatabase(db);
    const now = new Date();
    db.prepare('UPDATE deals SET expected_close_date = ? WHERE id = ?').run(
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      'deal_acme',
    );
    db.prepare('UPDATE tasks SET due_at = ? WHERE id = ?').run(
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      'task_today',
    );
    db.prepare('UPDATE deals SET currency = ? WHERE id = ?').run('EUR', 'deal_aurora');
    db.prepare(
      'INSERT INTO deal_stage_history (id, organization_id, deal_id, from_stage_id, to_stage_id, actor_id, changed_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'dsh_dashboard_won',
      'org_northstar',
      'deal_denali',
      'stage_negotiation',
      'stage_won',
      'usr_owner',
      now.toISOString(),
      'Dashboard reconciliation fixture',
    );
    db.prepare(
      'INSERT INTO activities (id, organization_id, type, subject, occurred_at, creator_id, company_id, creator_name_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'act_dashboard',
      'org_northstar',
      'note',
      'Dashboard reconciliation fixture',
      now.toISOString(),
      'usr_owner',
      'co_acme',
      'Northstar Owner',
      now.toISOString(),
      now.toISOString(),
    );
    db.close();
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const signIn = async (email, password) =>
      (
        await fetch(`${url}/api/auth/sign-in`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      ).headers.get('set-cookie');
    const owner = await signIn('owner@northstar.test', 'OwnerPass!2026');
    const member = await signIn('member@northstar.test', 'MemberPass!2026');
    const viewer = await signIn('viewer@northstar.test', 'ViewerPass!2026');
    const outside = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    const request = async (path, cookie = owner) => {
      const response = await fetch(`${url}${path}`, { headers: { cookie } });
      expect(response.ok).toBe(true);
      return response.json();
    };
    const dashboard = await request('/api/dashboard');
    expect(dashboard.pipeline).toEqual([
      expect.objectContaining({ currency: 'EUR', amountCents: 220000 }),
      expect.objectContaining({ currency: 'USD', amountCents: expect.any(Number) }),
    ]);
    expect(dashboard.closingSoon).toBeGreaterThan(0);
    expect(dashboard.tasks.upcoming).toBeGreaterThan(0);
    expect(dashboard.trend).toEqual(expect.any(Array));
    expect(dashboard.semantics).toMatchObject({
      timezone: 'UTC',
      closingSoonDays: 30,
      staleAccountDays: 30,
    });

    // Every dashboard card opens a list whose count and filters use the same evidence.
    const openDeals = await request('/api/deals?status=open');
    expect(openDeals.aggregates).toEqual(dashboard.pipeline);
    const closingFrom = dashboard.generatedAt.slice(0, 10);
    const closingTo = new Date(
      new Date(dashboard.generatedAt).getTime() + dashboard.semantics.closingSoonDays * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(
      (
        await request(
          `/api/deals?status=open&expectedCloseFrom=${closingFrom}&expectedCloseTo=${closingTo}`,
        )
      ).total,
    ).toBe(dashboard.closingSoon);
    expect((await request('/api/tasks?due=overdue')).total).toBe(dashboard.tasks.overdue);
    const upcomingTo = new Date(
      new Date(dashboard.generatedAt).getTime() + dashboard.semantics.upcomingTaskDays * 86_400_000,
    ).toISOString();
    expect(
      (
        await request(
          `/api/tasks?dueFrom=${encodeURIComponent(dashboard.generatedAt)}&dueTo=${encodeURIComponent(upcomingTo)}`,
        )
      ).total,
    ).toBe(dashboard.tasks.upcoming);
    for (const stage of dashboard.stages)
      expect((await request(`/api/deals?stageId=${stage.id}`)).total).toBe(stage.count);
    const staleBefore = new Date(
      new Date(dashboard.generatedAt).getTime() - dashboard.semantics.staleAccountDays * 86_400_000,
    ).toISOString();
    expect(
      (await request(`/api/companies?staleBefore=${encodeURIComponent(staleBefore)}`)).total,
    ).toBe(dashboard.staleAccounts);
    for (const kind of ['won', 'lost'])
      expect(
        (
          await request(
            `/api/deals?status=${kind}&transitionedSince=${encodeURIComponent(staleBefore)}`,
          )
        ).total,
      ).toBe(dashboard.trend.find((entry) => entry.kind === kind)?.count || 0);
    const recent = dashboard.recentActivity[0];
    const relatedRecordId = recent.companyId || recent.contactId || recent.dealId || recent.taskId;
    const relatedActivities = await request(
      `/api/activities?relatedRecordId=${encodeURIComponent(relatedRecordId)}`,
    );
    expect(relatedActivities.items.map((activity) => activity.id)).toContain(recent.id);

    // Read-only member and viewer roles see the same tenant-scoped evidence.
    expect((await request('/api/dashboard', member)).pipeline).toEqual(dashboard.pipeline);
    expect((await request('/api/dashboard', viewer)).pipeline).toEqual(dashboard.pipeline);
    const outsideDashboard = await request('/api/dashboard', outside);
    expect(outsideDashboard.pipeline).toEqual([]);
    expect(outsideDashboard.recentActivity).toEqual([]);
  });
});
