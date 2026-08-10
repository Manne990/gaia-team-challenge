# Notification policy

Northstar creates personal, organization-scoped in-app notifications when the
recipient opens the Notifications page or explicitly calls the generation API.
Generation runs in one immediate SQLite transaction and may be replayed safely.
The database uniqueness key includes organization, recipient membership, and
the policy key described below.

## Rules and keys

- Task assignment is derived from immutable `task.created` and reassignment
  audit events. The recipient recorded by that event receives one notification
  keyed by the audit-event ID. Editing a task without changing its assignee does
  not notify. Reassignment notifies the new assignee; the former assignee keeps
  their historical notification and personal read state.
- Approaching tasks are active, unarchived tasks assigned to the recipient with
  `due_at` between the current UTC instant (inclusive) and exactly 24 hours later
  (inclusive). The key contains task ID and the exact UTC due timestamp.
- Overdue tasks are active, unarchived tasks assigned to the recipient with
  `due_at` strictly before the current UTC instant. Its separate key also
  contains task ID and due timestamp, so a previously approaching task produces
  one overdue notification when it crosses the boundary, never one per replay.
- Material deal changes are explicit stage transitions. The owner recorded in
  the transition audit event receives one notification keyed by that event ID.
  Later ownership changes do not transfer historical notifications.

Completed, cancelled, and archived tasks do not generate time-based notices.
Existing notices remain historical after reassignment or archival. If a related
record still exists, navigation leads to its organization-authorized work list;
if it has been deleted, the notice remains but no record link is rendered.
Notification listing, unread filtering, mark-one-read, and mark-all-read always
scope by both authenticated organization and recipient membership. Read state
is idempotent and never shared between users.
