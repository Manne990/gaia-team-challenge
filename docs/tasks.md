# Task due-state policy

Task timestamps are accepted with an explicit ISO 8601 offset and normalized to
UTC before persistence. The V1 interface displays and groups due times in UTC,
and labels that policy rather than inferring the browser's local timezone.

- `overdue`: incomplete tasks with `due_at` earlier than the current UTC instant
- `today`: incomplete tasks whose UTC calendar date is today
- `upcoming`: incomplete tasks after the end of the current UTC calendar date
- `completed`: completed tasks regardless of completion date
- `assigned_to_me`: incomplete tasks assigned to the authenticated membership

Today and overdue intentionally overlap after a task's due time has passed.
Clients send the displayed task version for edits and lifecycle transitions;
HTTP 409 instructs them to refresh instead of silently overwriting a newer edit.
