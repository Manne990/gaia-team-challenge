const day = (date) => new Date(date).toISOString();

/** A deterministic, complete cross-tenant dataset for product and browser tests. */
export function createProductFixtures() {
  const northstar = "org_northstar_demo";
  const outside = "org_outside_demo";
  const users = [
    { id: "usr_northstar_owner", organizationId: northstar, role: "owner", email: "owner@northstar.test" },
    { id: "usr_northstar_member", organizationId: northstar, role: "member", email: "member@northstar.test" },
    { id: "usr_northstar_viewer", organizationId: northstar, role: "viewer", email: "viewer@northstar.test" },
    { id: "usr_outside_owner", organizationId: outside, role: "owner", email: "other-owner@outside.test" },
  ];
  const northstarCompanies = Array.from({ length: 27 }, (_, index) => ({
    id: `cmp_northstar_${String(index + 1).padStart(2, "0")}`,
    organizationId: northstar,
    name: index < 2 ? "Acme Holdings" : `Northstar Account ${index + 1}`,
    lifecycle: index % 3 === 0 ? "customer" : "lead",
  }));
  return {
    organizations: [
      { id: northstar, name: "Northstar Demo" },
      { id: outside, name: "Outside Demo" },
    ],
    users,
    companies: [
      ...northstarCompanies,
      { id: "cmp_outside_acme", organizationId: outside, name: "Acme Holdings", lifecycle: "customer" },
    ],
    contacts: [
      { id: "con_northstar_ada", organizationId: northstar, companyId: "cmp_northstar_01", firstName: "Ada", lastName: "Lovelace" },
      { id: "con_outside_grace", organizationId: outside, companyId: "cmp_outside_acme", firstName: "Grace", lastName: "Hopper" },
    ],
    activities: [
      { id: "act_historical", organizationId: northstar, companyId: "cmp_northstar_01", type: "call", occurredAt: day("2024-01-15T10:00:00Z") },
      { id: "act_recent", organizationId: northstar, companyId: "cmp_northstar_02", type: "meeting", occurredAt: day("2026-01-15T10:00:00Z") },
    ],
    deals: [
      { id: "deal_discovery", organizationId: northstar, stage: "discovery", amount: 1000 },
      { id: "deal_proposal", organizationId: northstar, stage: "proposal", amount: 4000 },
      { id: "deal_won", organizationId: northstar, stage: "won", amount: 8000 },
    ],
    tasks: [
      { id: "task_overdue", organizationId: northstar, dueAt: day("2025-01-01T09:00:00Z"), status: "open" },
      { id: "task_upcoming", organizationId: northstar, dueAt: day("2027-01-01T09:00:00Z"), status: "open" },
    ],
  };
}
