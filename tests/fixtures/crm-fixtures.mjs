/**
 * Stable, intentionally small product data for tests. IDs are opaque and do
 * not depend on insertion order, so a test can safely select records by ID.
 */
export const fixtureClock = '2026-08-01T12:00:00.000Z';

export function createCrmFixtures() {
  const northstar = { id: 'org_northstar_demo', name: 'Northstar Demo' };
  const outside = { id: 'org_outside_demo', name: 'Outside Demo' };
  const users = [
    {
      id: 'usr_northstar_owner',
      organizationId: northstar.id,
      email: 'owner@northstar.test',
      role: 'owner',
    },
    {
      id: 'usr_northstar_member',
      organizationId: northstar.id,
      email: 'member@northstar.test',
      role: 'member',
    },
    {
      id: 'usr_northstar_viewer',
      organizationId: northstar.id,
      email: 'viewer@northstar.test',
      role: 'viewer',
    },
    {
      id: 'usr_outside_owner',
      organizationId: outside.id,
      email: 'other-owner@outside.test',
      role: 'owner',
    },
  ];
  const companies = Array.from({ length: 28 }, (_, index) => ({
    id: `cmp_northstar_${String(index + 1).padStart(2, '0')}`,
    organizationId: northstar.id,
    name: index < 2 ? 'Acme Corporation' : `Northstar Account ${index + 1}`,
    lifecycle: index % 3 === 0 ? 'customer' : 'lead',
  }));
  companies.push({
    id: 'cmp_outside_01',
    organizationId: outside.id,
    name: 'Acme Corporation',
    lifecycle: 'lead',
  });

  const contacts = [
    {
      id: 'con_northstar_01',
      organizationId: northstar.id,
      companyId: companies[0].id,
      firstName: 'Avery',
      lastName: 'Ng',
      email: 'avery@acme.test',
    },
    {
      id: 'con_northstar_02',
      organizationId: northstar.id,
      companyId: companies[1].id,
      firstName: 'Avery',
      lastName: 'Ng',
      email: 'avery.duplicate@acme.test',
    },
    {
      id: 'con_outside_01',
      organizationId: outside.id,
      companyId: 'cmp_outside_01',
      firstName: 'Riley',
      lastName: 'Stone',
      email: 'riley@outside.test',
    },
  ];
  const stages = [
    { id: 'stage_qualified', name: 'Qualified', position: 1 },
    { id: 'stage_proposal', name: 'Proposal', position: 2 },
    { id: 'stage_negotiation', name: 'Negotiation', position: 3 },
    { id: 'stage_won', name: 'Closed won', position: 4 },
  ];
  const deals = stages.map((stage, index) => ({
    id: `deal_northstar_${index + 1}`,
    organizationId: northstar.id,
    companyId: companies[index].id,
    stageId: stage.id,
    name: `${stage.name} renewal`,
    amountCents: (index + 1) * 250000,
  }));
  const tasks = [
    {
      id: 'tsk_overdue',
      organizationId: northstar.id,
      title: 'Call overdue account',
      dueAt: '2026-07-30T09:00:00.000Z',
      status: 'open',
    },
    {
      id: 'tsk_today',
      organizationId: northstar.id,
      title: 'Send proposal',
      dueAt: '2026-08-01T16:00:00.000Z',
      status: 'open',
    },
    {
      id: 'tsk_upcoming',
      organizationId: northstar.id,
      title: 'Book discovery',
      dueAt: '2026-08-07T09:00:00.000Z',
      status: 'open',
    },
  ];
  const activities = [
    {
      id: 'act_historical',
      organizationId: northstar.id,
      companyId: companies[0].id,
      type: 'call',
      subject: 'Discovery call',
      occurredAt: '2025-12-15T10:30:00.000Z',
    },
    {
      id: 'act_recent',
      organizationId: northstar.id,
      companyId: companies[0].id,
      type: 'meeting',
      subject: 'Proposal review',
      occurredAt: '2026-07-31T14:00:00.000Z',
    },
  ];

  return {
    clock: fixtureClock,
    organizations: [northstar, outside],
    users,
    companies,
    contacts,
    stages,
    deals,
    tasks,
    activities,
  };
}
