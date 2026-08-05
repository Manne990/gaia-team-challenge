import { hashSync } from 'bcryptjs';

const NOW = '2026-01-15T12:00:00.000Z';

function hashSeedPassword(password) {
  return hashSync(password, 12);
}

function run(db, sql, values) {
  db.prepare(sql).run(...values);
}

export function seedDatabase(db) {
  const seed = db.transaction(() => {
    const organizations = [
      ['org-northstar', 'Northstar Demo'],
      ['org-outside', 'Outside Demo'],
    ];
    for (const [id, name] of organizations) {
      run(
        db,
        'INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [id, name, NOW, NOW],
      );
    }
    const users = [
      ['user-owner', 'owner@northstar.test', 'Northstar Owner', 'OwnerPass!2026'],
      ['user-member', 'member@northstar.test', 'Northstar Member', 'MemberPass!2026'],
      ['user-viewer', 'viewer@northstar.test', 'Northstar Viewer', 'ViewerPass!2026'],
      ['user-outside-owner', 'other-owner@outside.test', 'Outside Owner', 'OutsidePass!2026'],
    ];
    for (const [id, email, displayName, password] of users) {
      run(
        db,
        'INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, displayName, hashSeedPassword(password), NOW, NOW],
      );
    }
    const memberships = [
      ['membership-northstar-owner', 'org-northstar', 'user-owner', 'owner'],
      ['membership-northstar-member', 'org-northstar', 'user-member', 'member'],
      ['membership-northstar-viewer', 'org-northstar', 'user-viewer', 'viewer'],
      ['membership-outside-owner', 'org-outside', 'user-outside-owner', 'owner'],
    ];
    for (const [id, orgId, userId, role] of memberships) {
      run(
        db,
        'INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, orgId, userId, role, NOW, NOW],
      );
    }
    const stages = [
      ['stage-lead', 'Lead', 0, 'open'],
      ['stage-qualified', 'Qualified', 1, 'open'],
      ['stage-proposal', 'Proposal', 2, 'open'],
      ['stage-won', 'Won', 3, 'won'],
      ['stage-lost', 'Lost', 4, 'lost'],
    ];
    for (const [id, name, position, category] of stages) {
      run(
        db,
        "INSERT OR IGNORE INTO pipeline_stages (id, organization_id, name, position, category, created_at, updated_at) VALUES (?, 'org-northstar', ?, ?, ?, ?, ?)",
        [id, name, position, category, NOW, NOW],
      );
    }
    for (let index = 1; index <= 15; index += 1) {
      const id = `company-northstar-${index}`;
      run(
        db,
        "INSERT OR IGNORE INTO companies (id, organization_id, name, external_reference, industry, lifecycle_status, owner_membership_id, tags_json, created_at, updated_at) VALUES (?, 'org-northstar', ?, ?, ?, ?, 'membership-northstar-owner', ?, ?, ?)",
        [
          id,
          `Northstar Account ${index}`,
          `NS-${String(index).padStart(3, '0')}`,
          index % 2 ? 'Technology' : 'Retail',
          index < 6 ? 'lead' : 'customer',
          JSON.stringify(index % 2 ? ['priority'] : ['renewal']),
          NOW,
          NOW,
        ],
      );
      run(
        db,
        "INSERT OR IGNORE INTO contacts (id, organization_id, first_name, last_name, email, job_title, owner_membership_id, company_id, created_at, updated_at) VALUES (?, 'org-northstar', ?, ?, ?, 'Operations Lead', 'membership-northstar-member', ?, ?, ?)",
        [
          `contact-northstar-${index}`,
          `Contact${index}`,
          'Northstar',
          `contact${index}@northstar-account.test`,
          id,
          NOW,
          NOW,
        ],
      );
      const status = index % 5 === 0 ? 'completed' : 'open';
      run(
        db,
        "INSERT OR IGNORE INTO tasks (id, organization_id, title, assignee_membership_id, due_at, priority, status, company_id, completed_at, created_at, updated_at) VALUES (?, 'org-northstar', ?, 'membership-northstar-member', ?, ?, ?, ?, ?, ?, ?)",
        [
          `task-northstar-${index}`,
          `Follow up with Northstar Account ${index}`,
          `2026-01-${String((index % 20) + 1).padStart(2, '0')}T09:00:00.000Z`,
          index % 3 === 0 ? 'high' : 'medium',
          status,
          id,
          status === 'completed' ? NOW : null,
          NOW,
          NOW,
        ],
      );
    }
    for (let index = 1; index <= 8; index += 1) {
      const companyId = `company-northstar-${index}`;
      const stageId =
        index % 4 === 0 ? 'stage-won' : index % 3 === 0 ? 'stage-proposal' : 'stage-qualified';
      const status = stageId === 'stage-won' ? 'won' : 'open';
      run(
        db,
        "INSERT OR IGNORE INTO deals (id, organization_id, name, company_id, owner_membership_id, amount_minor, currency, expected_close_date, probability, stage_id, status, created_at, updated_at) VALUES (?, 'org-northstar', ?, ?, 'membership-northstar-owner', ?, 'USD', ?, ?, ?, ?, ?, ?)",
        [
          `deal-northstar-${index}`,
          `Northstar Opportunity ${index}`,
          companyId,
          index * 125000,
          `2026-02-${String(index).padStart(2, '0')}`,
          index * 10,
          stageId,
          status,
          NOW,
          NOW,
        ],
      );
      run(
        db,
        "INSERT OR IGNORE INTO deal_contacts (organization_id, deal_id, contact_id, created_at) VALUES ('org-northstar', ?, ?, ?)",
        [`deal-northstar-${index}`, `contact-northstar-${index}`, NOW],
      );
      run(
        db,
        "INSERT OR IGNORE INTO activities (id, organization_id, type, subject, body, occurred_at, creator_membership_id, company_id, contact_id, deal_id, follow_up_task_id, created_at) VALUES (?, 'org-northstar', 'note', ?, 'Seeded historical activity', ?, 'membership-northstar-member', ?, ?, ?, ?, ?)",
        [
          `activity-northstar-${index}`,
          `Discovery note ${index}`,
          `2026-01-${String(index).padStart(2, '0')}T10:00:00.000Z`,
          companyId,
          `contact-northstar-${index}`,
          `deal-northstar-${index}`,
          `task-northstar-${index}`,
          NOW,
        ],
      );
    }
    run(
      db,
      "INSERT OR IGNORE INTO companies (id, organization_id, name, external_reference, owner_membership_id, created_at, updated_at) VALUES ('company-outside-1', 'org-outside', 'Outside Account', 'OUT-001', 'membership-outside-owner', ?, ?)",
      [NOW, NOW],
    );
    run(
      db,
      "INSERT OR IGNORE INTO audit_events (id, organization_id, actor_membership_id, action, entity_type, entity_id, change_summary_json, created_at) VALUES ('audit-seed', 'org-northstar', 'membership-northstar-owner', 'seed.completed', 'organization', 'org-northstar', '{\"source\":\"deterministic-seed\"}', ?)",
      [NOW],
    );
  });
  seed();
}
