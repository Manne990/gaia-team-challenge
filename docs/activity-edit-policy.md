# Activity edit policy

Activities are immutable records of who created them and when they were first
recorded. Members may correct activities they created for 24 hours; owners may
correct any activity later for administrative recovery. Edits require the
visible record version, preserve creator and creation facts, append an audit
event, and never edit audit history. Viewers have read-only access.

Display labels captured with the activity remain safe and intelligible if a
creator is removed or a related record is renamed or archived. Links retain
their organization-scoped identifiers. An activity and its optional follow-up
task are created in one immediate transaction, so neither can exist alone.
