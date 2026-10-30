# Recurring chores

Chores are shared schedules, separate from tasks and their queues. Manage them from **Chores**; **Now** shows overdue/today chores assigned to the active profile or Everyone, between Focus and Queue.

## Scheduling

Choose a start date and repeat every 1–1000 days, weeks, months, or years. Presets include weekdays, fortnightly, twice a month (1st/15th), and quarterly. Six-month intervals give twice-yearly schedules. Optional weekdays, month days, and months intersect; clear a filter to remove that restriction.

Weeks start Monday. Weekly schedules without selected weekdays use the start weekday. Monthly/yearly schedules without selected month days use the start day; yearly schedules without selected months use the start month. Missing calendar dates are skipped (January 31 does not become February 28); choose **Last day** for month-end behavior. Date calculations use the server's configured calendar date, independent of daylight-saving hour changes.

## Outstanding work and rotation

Each schedule has at most one outstanding occurrence. Every new scheduled date increases its count, displayed as ×2, ×3, etc. The oldest due date and current assignee remain unchanged. Completing once clears the entire accumulated count and advances the rotation once. The next occurrence arrives on its next scheduled date, assigned to the next person. No background job is needed: reads and mutations materialize all dates since the last check.

No selected assignees means Everyone: all profiles see the same occurrence; one completion clears it for everyone. Multiple assignees form an ordered rotation. Reassignment moves the current outstanding occurrence, including its accumulated count, without changing the schedule's rotation order or advancing its turn.

Schedule edits apply from tomorrow and preserve outstanding dates/assignments. Pause stops new occurrences while keeping unfinished work. Resume includes today if it matches, skipping dates spent paused. Completed history shows the latest 100 occurrences; undo restores the count and rotation only until a newer occurrence exists.

## Implementation and data

- `src/lib/domain/chores.ts`: validated calendar rules and recurrence enumeration.
- `src/lib/server/chores.ts`: transactional generation, counts, assignment, completion, rotation, and optimistic revisions.
- `src/lib/server/chore-actions.ts`: shared web/Android mutation boundaries and profile/date guards.
- `chores`, `chore_assignees`, `chore_occurrences`: additive SQLite migration; existing database receives a pre-migration backup.
- JSON and SQLite backups include all chore state; pre-chores backups restore with empty chore tables.
- Native Android uses the same server loaders/actions through `/api/mobile/chores`. Chore creation/editing is native Compose, including date selection, presets, filters, and ordered rotation.

Tests cover recurrence boundaries, accrued counts, completion/undo, assignments, stale requests, migration, backup restore, and native API parity. Android instrumentation covers creating and completing a chore from Now; web browser checks cover create/edit controls, reassignment, pause/resume, completion, undo, responsive layout, and Now section placement.
