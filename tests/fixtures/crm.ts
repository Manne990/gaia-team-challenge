export type Role = "owner" | "member" | "viewer";

export interface FixtureOrganization {
  id: string;
  name: string;
}

export interface FixtureUser {
  id: string;
  organizationId: string;
  email: string;
  password: string;
  role: Role;
}

const northstarId = "org_northstar_demo";
const outsideId = "org_outside_demo";

export const organizations = [
  { id: northstarId, name: "Northstar Demo" },
  { id: outsideId, name: "Outside Demo" },
] as const satisfies readonly FixtureOrganization[];

export const users = [
  {
    id: "usr_northstar_owner",
    organizationId: northstarId,
    email: "owner@northstar.test",
    password: "OwnerPass!2026",
    role: "owner",
  },
  {
    id: "usr_northstar_member",
    organizationId: northstarId,
    email: "member@northstar.test",
    password: "MemberPass!2026",
    role: "member",
  },
  {
    id: "usr_northstar_viewer",
    organizationId: northstarId,
    email: "viewer@northstar.test",
    password: "ViewerPass!2026",
    role: "viewer",
  },
  {
    id: "usr_outside_owner",
    organizationId: outsideId,
    email: "other-owner@outside.test",
    password: "OutsidePass!2026",
    role: "owner",
  },
] as const satisfies readonly FixtureUser[];

const daysFromAnchor = (days: number) =>
  new Date(Date.UTC(2026, 0, 15 + days, 12)).toISOString();

export const pipelineStages = [
  {
    id: "stage_qualified",
    organizationId: northstarId,
    name: "Qualified",
    order: 1,
  },
  {
    id: "stage_proposal",
    organizationId: northstarId,
    name: "Proposal",
    order: 2,
  },
  { id: "stage_won", organizationId: northstarId, name: "Won", order: 3 },
] as const;

export const companies = Array.from({ length: 37 }, (_, index) => ({
  id: `company_northstar_${String(index + 1).padStart(3, "0")}`,
  organizationId: northstarId,
  // Duplicate display names are deliberate; identity must never depend on a label.
  name:
    index < 2 ? "Acme Group" : `Company ${String(index + 1).padStart(2, "0")}`,
  createdAt: daysFromAnchor(-90 + index),
}));

export const outsideCompanies = [
  {
    id: "company_outside_001",
    organizationId: outsideId,
    name: "Acme Group",
    createdAt: daysFromAnchor(-20),
  },
] as const;

export const contacts = [
  {
    id: "contact_northstar_001",
    organizationId: northstarId,
    companyId: companies[0].id,
    firstName: "Alex",
    lastName: "Kim",
  },
  {
    id: "contact_northstar_002",
    organizationId: northstarId,
    companyId: companies[1].id,
    firstName: "Alex",
    lastName: "Kim",
  },
  {
    id: "contact_outside_001",
    organizationId: outsideId,
    companyId: outsideCompanies[0].id,
    firstName: "Alex",
    lastName: "Kim",
  },
] as const;

export const activities = [
  {
    id: "activity_historical",
    organizationId: northstarId,
    companyId: companies[0].id,
    type: "call",
    occurredAt: daysFromAnchor(-365),
    subject: "Historical renewal call",
  },
  {
    id: "activity_recent",
    organizationId: northstarId,
    companyId: companies[0].id,
    type: "meeting",
    occurredAt: daysFromAnchor(-1),
    subject: "Recent account review",
  },
] as const;

export const deals = pipelineStages.map((stage, index) => ({
  id: `deal_northstar_${index + 1}`,
  organizationId: northstarId,
  companyId: companies[index].id,
  stageId: stage.id,
  name: `${stage.name} opportunity`,
  amountCents: (index + 1) * 125_000,
}));

export const tasks = [
  {
    id: "task_overdue",
    organizationId: northstarId,
    title: "Overdue follow-up",
    dueAt: daysFromAnchor(-2),
    status: "open",
  },
  {
    id: "task_upcoming",
    organizationId: northstarId,
    title: "Upcoming follow-up",
    dueAt: daysFromAnchor(5),
    status: "open",
  },
  {
    id: "task_completed",
    organizationId: northstarId,
    title: "Completed follow-up",
    dueAt: daysFromAnchor(-5),
    status: "completed",
  },
] as const;

export const crmFixture = {
  anchorTime: daysFromAnchor(0),
  organizations,
  users,
  pipelineStages,
  companies: [...companies, ...outsideCompanies],
  contacts,
  activities,
  deals,
  tasks,
} as const;
