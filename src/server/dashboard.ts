import type Database from 'better-sqlite3';

export type DashboardActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export function dashboard(
  db: Database.Database,
  actor: DashboardActor,
  now = new Date().toISOString(),
) {
  const week = new Date(now);
  week.setUTCDate(week.getUTCDate() + 7);
  const one = (sql: string, ...values: unknown[]) =>
    db.prepare(sql).get(...values) as Record<string, number>;
  const open = one(
    "SELECT count(*) AS count,coalesce(sum(amount_minor),0) AS amountMinor FROM deals WHERE organization_id=? AND archived_at IS NULL AND status='open'",
    actor.organizationId,
  );
  const overdue = one(
    "SELECT count(*) AS count FROM tasks WHERE organization_id=? AND archived_at IS NULL AND status NOT IN ('completed','cancelled') AND due_at < ?",
    actor.organizationId,
    now,
  );
  const upcoming = one(
    "SELECT count(*) AS count FROM tasks WHERE organization_id=? AND archived_at IS NULL AND status NOT IN ('completed','cancelled') AND due_at >= ? AND due_at < ?",
    actor.organizationId,
    now,
    week.toISOString(),
  );
  return {
    semantics: {
      timestamp: now,
      currency: 'minor units grouped by ISO currency',
      closingSoonWindow: `[${now}, ${week.toISOString()})`,
      staleAccountDays: 30,
    },
    openPipeline: open,
    overdueTasks: overdue.count,
    upcomingTasks: upcoming.count,
    stageDistribution: db
      .prepare(
        "SELECT s.id,s.name,s.position,count(d.id) AS count,coalesce(sum(d.amount_minor),0) AS amountMinor FROM pipeline_stages s LEFT JOIN deals d ON d.stage_id=s.id AND d.organization_id=s.organization_id AND d.archived_at IS NULL AND d.status='open' WHERE s.organization_id=? GROUP BY s.id ORDER BY s.position",
      )
      .all(actor.organizationId),
    closingSoon: db
      .prepare(
        "SELECT id,name,amount_minor,currency,expected_close_date FROM deals WHERE organization_id=? AND archived_at IS NULL AND status='open' AND expected_close_date >= ? AND expected_close_date < ? ORDER BY expected_close_date,id",
      )
      .all(actor.organizationId, now.slice(0, 10), week.toISOString().slice(0, 10)),
    recentActivity: db
      .prepare(
        'SELECT id,subject,type,occurred_at FROM activities WHERE organization_id=? ORDER BY occurred_at DESC,id DESC LIMIT 10',
      )
      .all(actor.organizationId),
    staleAccounts: db
      .prepare(
        'SELECT c.id,c.name,c.updated_at FROM companies c WHERE c.organization_id=? AND c.archived_at IS NULL AND c.updated_at < ? ORDER BY c.updated_at,c.id LIMIT 25',
      )
      .all(actor.organizationId, new Date(new Date(now).getTime() - 30 * 86400000).toISOString()),
  };
}
