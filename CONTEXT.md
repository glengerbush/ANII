# Domain glossary

## Profile

A named user/planning perspective selected without authentication. Anyone with server access may switch profiles.

## Task

A shared unit of work. Its content, dependencies, project labels, schedule, and completion state are shared across profiles.

## Schedule

A task’s single start date and assignee. Selecting another date or assignee replaces its schedule; removing its schedule leaves the task in Backlog.

## Backlog order

A profile’s personal ordering of the full unfinished Backlog, with queued-up tasks above unqueued tasks and manual ordering within each group. Each profile orders the shared tasks independently; the relative order of Queue tasks is shared with Now, so reordering in either view updates both.

## Queued up

A task included in the current profile’s Now view, whether in Focus or Queue. “Queue up” adds it to Now and places it at the bottom of the queued-up Backlog group, directly above unqueued tasks.

## Unqueue

A profile-specific dismissal that moves a task to the top of that profile’s unqueued Backlog group and hides it from Now for the current calendar date. Its shared Schedule remains unchanged.

## Everyone

An assignment shared by all profiles, including profiles created later. It is distinct from an unscheduled task.

## Now

The current profile’s unfinished tasks whose start dates have arrived, including Everyone assignments. It follows the actual calendar date in the configured timezone. Manual additions start today and remain until completed.

## Focus and Queue

A profile’s personal placement and ordering of eligible work. Focus holds up to three priorities with its own order; other work is in Queue, whose order is shared with Backlog. Unfinished placement and ordering carry forward as dates advance; returning tasks retain their Focus preference when capacity allows.

## Hidden for the day

A profile-specific dismissal from Now for one calendar date. It leaves the schedule and other profiles unchanged; the task returns the next day if still eligible.

## Calendar

Week and month views of task start dates. A profile filter includes that profile’s tasks plus Everyone assignments; the Everyone filter includes all assignments.

## Completion

Shared completion removes a task from every profile’s Now queue. Completion history records the actual completion date for the acting profile and other profiles where the task was visible. Reopening clears that attribution and makes an eligible scheduled task available again.
