# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Product Purpose

ANII organizes shared tasks into personal Now queues and calendars.

## Capabilities and Constraints

- Named profiles share tasks, projects, dependencies, and completion state.
- A task has one start date and one assignee or Everyone. It remains in Now from its start date until completed; dismissal hides it for the current profile/day.
- Week/month calendars display start dates, with live task search and immediate assignment.
- Focus holds up to three personal priorities; Queue holds other eligible work.
- The actual date drives Now. There is no daily Review workflow.
- Backlog search and filters remain visible.
- Preserve the existing app’s visual style and keyboard-accessible controls.

- Backlog order is personal: queued-up tasks first, with manual ordering inside each group. Queue up appends to queued tasks; Unqueue promotes to the top of unqueued tasks for that day.
- Project task ordering is shared across profiles and independent of personal queues. New tasks append to the project; completed tasks retain their position when reopened.
- Backlog and Now share Queue order; Focus order stays independent. Filtered reordering preserves the relative order of hidden results.

- Completed projects appear in collapsed project history and can be reopened; project completion does not complete or hide its tasks.
- Now warnings can be dismissed for the current profile/day in the browser tab; changed warnings appear again. Plan-check results can be dismissed and rerun.

- Android uses native Compose screens and the shared server domain actions. Its server URL is saved after validation, retained through upgrades, and editable in Settings.

- Chores have independent recurrence rules and ordered assignee rotations. One outstanding occurrence accrues a ×count; completing clears all accrued dates and advances the rotation once. Reassignment moves the outstanding work; Everyone is shared.
- Now shows assigned/Everyone chores between Focus and Queue. Chores has its own navigation on web and Android, with schedule editing, pause/resume, reassignment, and completion history.
