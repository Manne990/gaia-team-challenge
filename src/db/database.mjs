import { DatabaseSync } from 'node:sqlite';
import { createHash, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultDatabasePath =
  process.env.NORTHSTAR_DB_PATH || join(root, 'data', 'northstar.sqlite');
const migrationsPath = join(root, 'migrations');
const seedTime = '2026-01-15T12:00:00.000Z';

export function openDatabase(filename = defaultDatabasePath) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
  );
  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map(({ name }) => name),
  );
  for (const name of readdirSync(migrationsPath)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    if (applied.has(name)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(join(migrationsPath, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        seedTime,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function resetDatabase(filename = defaultDatabasePath) {
  if (filename !== ':memory:' && existsSync(filename)) rmSync(filename);
  const db = openDatabase(filename);
  migrate(db);
  return db;
}

const passwordHash = (password) => {
  const salt = createHash('sha256').update(`northstar:${password}`).digest('hex').slice(0, 32);
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
};
const insert = (db, table, row) => {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((column) => row[column]));
};

export function seedDatabase(db) {
  migrate(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const organization of [
      { id: 'org_northstar', name: 'Northstar Demo' },
      { id: 'org_outside', name: 'Outside Demo' },
    ])
      insert(db, 'organizations', { ...organization, created_at: seedTime, updated_at: seedTime });
    for (const user of [
      ['usr_owner', 'owner@northstar.test', 'OwnerPass!2026', 'Northstar Owner'],
      ['usr_member', 'member@northstar.test', 'MemberPass!2026', 'Northstar Member'],
      ['usr_viewer', 'viewer@northstar.test', 'ViewerPass!2026', 'Northstar Viewer'],
      ['usr_outside', 'other-owner@outside.test', 'OutsidePass!2026', 'Outside Owner'],
    ])
      insert(db, 'users', {
        id: user[0],
        email: user[1],
        password_hash: passwordHash(user[2]),
        display_name: user[3],
        created_at: seedTime,
        updated_at: seedTime,
      });
    for (const membership of [
      ['mem_owner', 'org_northstar', 'usr_owner', 'owner'],
      ['mem_member', 'org_northstar', 'usr_member', 'member'],
      ['mem_viewer', 'org_northstar', 'usr_viewer', 'viewer'],
      ['mem_outside', 'org_outside', 'usr_outside', 'owner'],
    ])
      insert(db, 'memberships', {
        id: membership[0],
        organization_id: membership[1],
        user_id: membership[2],
        role: membership[3],
        created_at: seedTime,
        updated_at: seedTime,
      });
    const stages = [
      ['stage_qualified', 'Qualified', 0, 'open'],
      ['stage_proposal', 'Proposal', 1, 'open'],
      ['stage_negotiation', 'Negotiation', 2, 'open'],
      ['stage_won', 'Won', 3, 'won'],
      ['stage_lost', 'Lost', 4, 'lost'],
    ];
    for (const stage of stages)
      insert(db, 'pipeline_stages', {
        id: stage[0],
        organization_id: 'org_northstar',
        name: stage[1],
        position: stage[2],
        kind: stage[3],
        created_at: seedTime,
      });
    for (const [id, name, lifecycle] of [
      ['co_acme', 'Acme Industries', 'customer'],
      ['co_aurora', 'Aurora Labs', 'prospect'],
      ['co_birch', 'Birch & Co', 'lead'],
      ['co_cascade', 'Cascade Retail', 'prospect'],
      ['co_denali', 'Denali Systems', 'customer'],
      ['co_outside', 'Outside Co', 'customer'],
    ])
      insert(db, 'companies', {
        id,
        organization_id: id === 'co_outside' ? 'org_outside' : 'org_northstar',
        name,
        external_reference: `REF-${id}`,
        lifecycle_status: lifecycle,
        owner_id: id === 'co_outside' ? 'usr_outside' : 'usr_owner',
        tags_json: '["seed"]',
        created_at: seedTime,
        updated_at: seedTime,
      });
    for (const [id, company, first, last] of [
      ['ct_ada', 'co_acme', 'Ada', 'Lovelace'],
      ['ct_grace', 'co_aurora', 'Grace', 'Hopper'],
      ['ct_katherine', 'co_birch', 'Katherine', 'Johnson'],
      ['ct_margaret', 'co_cascade', 'Margaret', 'Hamilton'],
      ['ct_annie', 'co_denali', 'Annie', 'Easley'],
    ])
      insert(db, 'contacts', {
        id,
        organization_id: 'org_northstar',
        company_id: company,
        first_name: first,
        last_name: last,
        email: `${first.toLowerCase()}@example.test`,
        owner_id: 'usr_member',
        created_at: seedTime,
        updated_at: seedTime,
      });
    for (const [id, name, company, stage, amount, status] of [
      ['deal_acme', 'Acme renewal', 'co_acme', 'stage_negotiation', 850000, 'open'],
      ['deal_aurora', 'Aurora expansion', 'co_aurora', 'stage_proposal', 220000, 'open'],
      ['deal_denali', 'Denali support', 'co_denali', 'stage_won', 125000, 'won'],
    ])
      insert(db, 'deals', {
        id,
        organization_id: 'org_northstar',
        name,
        company_id: company,
        owner_id: 'usr_owner',
        stage_id: stage,
        amount_cents: amount,
        currency: 'USD',
        probability: status === 'won' ? 100 : 60,
        status,
        created_at: seedTime,
        updated_at: seedTime,
      });
    for (const [id, title, due, status, priority] of [
      ['task_overdue', 'Follow up with Acme', '2025-12-15T09:00:00.000Z', 'open', 'high'],
      [
        'task_today',
        'Prepare Aurora proposal',
        '2026-01-15T16:00:00.000Z',
        'in_progress',
        'medium',
      ],
      ['task_upcoming', 'Schedule Denali review', '2026-01-21T09:00:00.000Z', 'open', 'low'],
      ['task_done', 'Send welcome packet', '2026-01-10T09:00:00.000Z', 'completed', 'medium'],
    ])
      insert(db, 'tasks', {
        id,
        organization_id: 'org_northstar',
        title,
        due_at: due,
        status,
        priority,
        assignee_id: 'usr_member',
        company_id: 'co_acme',
        completed_at: status === 'completed' ? seedTime : null,
        created_at: seedTime,
        updated_at: seedTime,
      });
    for (const [id, type, subject, occurred] of [
      ['act_1', 'call', 'Discovery call with Acme', '2026-01-14T11:00:00.000Z'],
      ['act_2', 'email', 'Proposal sent to Aurora', '2026-01-13T15:00:00.000Z'],
      ['act_3', 'meeting', 'Denali quarterly review', '2026-01-12T10:00:00.000Z'],
    ])
      insert(db, 'activities', {
        id,
        organization_id: 'org_northstar',
        type,
        subject,
        occurred_at: occurred,
        creator_id: 'usr_member',
        creator_name_snapshot: 'Northstar Member',
        created_at: seedTime,
      });
    const fixtureStages = [
      'stage_qualified',
      'stage_proposal',
      'stage_negotiation',
      'stage_won',
      'stage_lost',
    ];
    const fixtureTypes = ['call', 'email', 'meeting', 'note', 'status_change'];
    for (let index = 1; index <= 25; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const companyId = `co_fixture_${suffix}`;
      const contactId = `ct_fixture_${suffix}`;
      const stageId = fixtureStages[index % fixtureStages.length];
      const status = stageId === 'stage_won' ? 'won' : stageId === 'stage_lost' ? 'lost' : 'open';
      const taskStatus = index % 5 === 0 ? 'completed' : index % 3 === 0 ? 'in_progress' : 'open';
      insert(db, 'companies', {
        id: companyId,
        organization_id: 'org_northstar',
        name: `Northstar Fixture ${suffix}`,
        external_reference: `FIX-${suffix}`,
        lifecycle_status: ['lead', 'prospect', 'customer'][index % 3],
        owner_id: index % 2 === 0 ? 'usr_owner' : 'usr_member',
        tags_json: JSON.stringify([index % 2 === 0 ? 'enterprise' : 'growth', 'fixture']),
        created_at: `2025-12-${String((index % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
        updated_at: seedTime,
      });
      insert(db, 'contacts', {
        id: contactId,
        organization_id: 'org_northstar',
        company_id: companyId,
        first_name: `Fixture${suffix}`,
        last_name: `Contact${suffix}`,
        email: `fixture-${suffix}@example.test`,
        owner_id: index % 2 === 0 ? 'usr_owner' : 'usr_member',
        created_at: seedTime,
        updated_at: seedTime,
      });
      insert(db, 'deals', {
        id: `deal_fixture_${suffix}`,
        organization_id: 'org_northstar',
        name: `Fixture opportunity ${suffix}`,
        company_id: companyId,
        owner_id: index % 2 === 0 ? 'usr_owner' : 'usr_member',
        stage_id: stageId,
        amount_cents: 50000 + index * 12500,
        currency: 'USD',
        probability: status === 'won' ? 100 : status === 'lost' ? 0 : 20 + (index % 4) * 20,
        status,
        loss_reason: status === 'lost' ? 'Budget deferred' : null,
        created_at: seedTime,
        updated_at: seedTime,
      });
      insert(db, 'tasks', {
        id: `task_fixture_${suffix}`,
        organization_id: 'org_northstar',
        title: `Fixture follow-up ${suffix}`,
        due_at: `2026-01-${String((index % 25) + 1).padStart(2, '0')}T${String(8 + (index % 8)).padStart(2, '0')}:00:00.000Z`,
        status: taskStatus,
        priority: ['low', 'medium', 'high'][index % 3],
        assignee_id: index % 2 === 0 ? 'usr_owner' : 'usr_member',
        company_id: companyId,
        contact_id: contactId,
        deal_id: `deal_fixture_${suffix}`,
        completed_at: taskStatus === 'completed' ? seedTime : null,
        created_at: seedTime,
        updated_at: seedTime,
      });
      insert(db, 'activities', {
        id: `act_fixture_${suffix}`,
        organization_id: 'org_northstar',
        type: fixtureTypes[index % fixtureTypes.length],
        subject: `Fixture activity ${suffix}`,
        occurred_at: `2026-01-${String((index % 20) + 1).padStart(2, '0')}T10:00:00.000Z`,
        creator_id: index % 2 === 0 ? 'usr_owner' : 'usr_member',
        company_id: companyId,
        contact_id: contactId,
        deal_id: `deal_fixture_${suffix}`,
        creator_name_snapshot: index % 2 === 0 ? 'Northstar Owner' : 'Northstar Member',
        company_label_snapshot: `Northstar Fixture ${suffix}`,
        contact_label_snapshot: `Fixture${suffix} Contact${suffix}`,
        deal_label_snapshot: `Fixture opportunity ${suffix}`,
        created_at: seedTime,
        updated_at: seedTime,
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function resetAndSeed(filename = defaultDatabasePath) {
  const db = resetDatabase(filename);
  seedDatabase(db);
  return db;
}
