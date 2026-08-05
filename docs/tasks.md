# Task due-time policy

Tasks store `due_at` as an ISO-8601 UTC timestamp. Operational API due-state
views (`overdue`, `due-today`, and `upcoming`) compare those UTC instants using
UTC calendar-day boundaries and return `displayTimezone: "UTC"`. Browser
clients must label times as UTC until a saved user timezone preference exists;
they must not silently reinterpret due-state boundaries using the browser's
local timezone.
