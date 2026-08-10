import type Database from "better-sqlite3";
import type { SessionIdentity } from "../auth/index.js";

type MoneyRow = { currency: string; amountMinor: number };

function totals(rows: MoneyRow[]) {
  const values = new Map<string, bigint>();
  for (const row of rows)
    values.set(
      row.currency,
      (values.get(row.currency) ?? 0n) + BigInt(row.amountMinor),
    );
  return [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({
      currency,
      amountMinor: amountMinor.toString(),
    }));
}

function monthStart(date: Date, offset = 0) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1),
  );
}

function dayStart(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export class DashboardService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(identity: SessionIdentity) {
    const asOf = this.now();
    const organizationId = identity.organizationId;
    const recentFrom = new Date(asOf.getTime() - 7 * 86_400_000);
    const upcomingTo = new Date(asOf.getTime() + 7 * 86_400_000);
    const staleBefore = new Date(asOf.getTime() - 30 * 86_400_000);
    const closeFrom = dayStart(asOf);
    const closeTo = new Date(closeFrom.getTime() + 30 * 86_400_000);
    const trendFrom = monthStart(asOf, -5);
    const trendTo = monthStart(asOf, 1);
    const activeDeal = "d.organization_id=? AND d.archived_at IS NULL";

    const openRows = this.db
      .prepare(
        `SELECT d.currency,d.amount_minor amountMinor FROM deals d
         WHERE ${activeDeal} AND d.status='open'`,
      )
      .all(organizationId) as MoneyRow[];
    const openCount = (
      this.db
        .prepare(
          `SELECT count(*) count FROM deals d WHERE ${activeDeal} AND d.status='open'`,
        )
        .get(organizationId) as { count: number }
    ).count;

    const stageRows = this.db
      .prepare(
        `SELECT s.id,s.name,s.position,count(d.id) count
         FROM pipeline_stages s LEFT JOIN deals d
           ON d.organization_id=s.organization_id AND d.stage_id=s.id
          AND d.archived_at IS NULL AND d.status='open'
         WHERE s.organization_id=? AND s.kind='open' AND s.active=1
         GROUP BY s.id,s.name,s.position ORDER BY s.position,s.id`,
      )
      .all(organizationId) as Array<{
      id: string;
      name: string;
      position: number;
      count: number;
    }>;
    const stageMoney = this.db
      .prepare(
        `SELECT d.stage_id stageId,d.currency,d.amount_minor amountMinor
         FROM deals d JOIN pipeline_stages s
           ON s.organization_id=d.organization_id AND s.id=d.stage_id
         WHERE ${activeDeal} AND d.status='open' AND s.kind='open'`,
      )
      .all(organizationId) as Array<MoneyRow & { stageId: string }>;

    const outcomeRows = this.db
      .prepare(
        `SELECT d.id,d.status,
          coalesce((SELECT max(h.changed_at) FROM deal_stage_history h
            JOIN pipeline_stages hs ON hs.id=h.to_stage_id AND hs.organization_id=h.organization_id
            WHERE h.organization_id=d.organization_id AND h.deal_id=d.id AND hs.kind=d.status),d.updated_at) outcomeAt
         FROM deals d WHERE ${activeDeal} AND d.status IN ('won','lost')`,
      )
      .all(organizationId) as Array<{
      id: string;
      status: "won" | "lost";
      outcomeAt: string;
    }>;
    const outcomeTrend = Array.from({ length: 6 }, (_, index) => {
      const from = monthStart(asOf, index - 5);
      const to = monthStart(asOf, index - 4);
      const inMonth = outcomeRows.filter(
        (row) =>
          row.outcomeAt >= from.toISOString() &&
          row.outcomeAt < to.toISOString(),
      );
      return {
        month: from.toISOString().slice(0, 7),
        from: from.toISOString(),
        to: to.toISOString(),
        won: inMonth.filter((row) => row.status === "won").length,
        lost: inMonth.filter((row) => row.status === "lost").length,
      };
    });

    const recentActivities = this.db
      .prepare(
        `SELECT a.id,a.type,a.subject,a.occurred_at occurredAt,a.creator_label creatorLabel,
          a.company_label companyLabel FROM activities a
         WHERE a.organization_id=? AND a.occurred_at>=? AND a.occurred_at<=?
         ORDER BY a.occurred_at DESC,a.id DESC LIMIT 8`,
      )
      .all(organizationId, recentFrom.toISOString(), asOf.toISOString());
    const recentActivityCount = (
      this.db
        .prepare(
          "SELECT count(*) count FROM activities WHERE organization_id=? AND occurred_at>=? AND occurred_at<=?",
        )
        .get(organizationId, recentFrom.toISOString(), asOf.toISOString()) as {
        count: number;
      }
    ).count;

    const taskCount = (where: string, ...params: unknown[]) =>
      (
        this.db
          .prepare(
            `SELECT count(*) count FROM tasks t WHERE t.organization_id=? AND t.archived_at IS NULL AND t.status NOT IN ('completed','cancelled') AND ${where}`,
          )
          .get(organizationId, ...params) as { count: number }
      ).count;
    const overdue = taskCount("t.due_at<?", asOf.toISOString());
    const upcoming = taskCount(
      "t.due_at>=? AND t.due_at<?",
      asOf.toISOString(),
      upcomingTo.toISOString(),
    );

    const closingRows = this.db
      .prepare(
        `SELECT d.currency,d.amount_minor amountMinor FROM deals d WHERE ${activeDeal}
         AND d.status='open' AND d.expected_close_date>=? AND d.expected_close_date<?`,
      )
      .all(
        organizationId,
        closeFrom.toISOString().slice(0, 10),
        closeTo.toISOString().slice(0, 10),
      ) as MoneyRow[];

    const stale = (
      this.db
        .prepare(
          `SELECT count(*) count FROM companies c WHERE c.organization_id=? AND c.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.organization_id=c.organization_id
             AND a.company_id=c.id AND a.occurred_at>=? AND a.occurred_at<=?)`,
        )
        .get(organizationId, staleBefore.toISOString(), asOf.toISOString()) as {
        count: number;
      }
    ).count;

    return {
      asOf: asOf.toISOString(),
      semantics: {
        recentFrom: recentFrom.toISOString(),
        upcomingTo: upcomingTo.toISOString(),
        closeFrom: closeFrom.toISOString().slice(0, 10),
        closeTo: closeTo.toISOString().slice(0, 10),
        staleBefore: staleBefore.toISOString(),
        trendFrom: trendFrom.toISOString(),
        trendTo: trendTo.toISOString(),
      },
      openPipeline: { count: openCount, totals: totals(openRows) },
      stageDistribution: stageRows.map((stage) => ({
        ...stage,
        totals: totals(stageMoney.filter((row) => row.stageId === stage.id)),
      })),
      outcomeTrend,
      recentActivity: { count: recentActivityCount, items: recentActivities },
      tasks: { overdue, upcoming },
      closingSoon: { count: closingRows.length, totals: totals(closingRows) },
      staleAccounts: { count: stale },
    };
  }
}
