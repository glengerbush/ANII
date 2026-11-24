# Task modules

Task behavior is shared by web and Android without sending native Task mutations through web page actions.

## Shared Task operations

`src/lib/server/task-operations.ts` owns Task input validation, Profile/date guards, allowed Task operations per view, and orchestration. Its interface accepts an operation, transport-neutral fields, selected Profile/Project context, and an optional SQLite instance. Repeated field values remain visible to validation.

`task-actions.ts` is the web adapter. It reads forms and returns Svelte action results; `redirectAfterSave` still controls progressive web navigation. The mobile route decodes JSON and invokes the same Task operation directly. Task mutations no longer construct a simulated web Request or translate a web redirect. Non-task flows (including Chat, Settings, and project lifecycle actions) retain their existing handling. Mobile reads still reuse page loaders.

`Planning` retains transactional ownership of Schedule, placement, daily visibility, Backlog order, Focus capacity, and Completion. This refactor does not introduce another implementation of those rules.

## Native Task module

`android/app/src/main/java/org/anii/app/Tasks.kt` owns Task/Schedule decoding and Task mutation encoding. Screens work with `Task`, `Assignment`, `TaskDetails`, `TaskLocation`, and `TaskChange`. The module knows the wire fields, assignment sentinels, action destinations, and differences between Now position moves and Backlog/Project anchor moves.

`AppModel.changeTask` supplies the existing HTTP adapter and retains busy state, mutation acknowledgement, refresh, and error handling. A recording adapter tests the same TaskChange interface used by screens. Task JSON decoding is checked on Android; server transport tests and the existing device flows remain in place. Chores, project lifecycle, and other unrelated native flows are outside this module.

## Task reads: measured decision

The review's third candidate was implemented narrowly as `src/lib/server/task-reads.ts`. Four loaders repeated metadata assembly, issuing three reads for every task. The module batches prerequisites, dependents, and history, preserving the latest 20 history events **per task**.

A disposable in-memory fixture used 300 tasks (180 open, 120 completed), 20 queued tasks, 80 project tasks, 75 dependency edges, and 7,500 task events. Counts below are executed prepared statements after warming placement reconciliation; transaction-control statements are excluded.

| View | Metadata reads before | Metadata reads after | Total reads/statements before → after |
| --- | ---: | ---: | ---: |
| Now | 420 | 3 | 442 → 25 |
| Backlog | 900 | 3 | 918 → 21 |
| Project | 240 | 3 | 253 → 16 |
| Completed | 360 | 3 | 367 → 10 |

The batching prototype matched the previous metadata exactly for all four selections. The committed tests cover both dependency directions, unselected tasks, duplicate input, per-task history limits, and query counts that stay bounded as selections grow. Timing varied with machine load, so the decision rests on query counts and equal results, not a claimed latency improvement.

Filtering, full task search, clocks, placement reconciliation, and response shapes remain unchanged. No caching, pagination, new database adapter, or schema migration was needed.
