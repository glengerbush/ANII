# Domain glossary

## Profile

A named planning perspective selected without authentication. Anyone with server access may switch profiles.

## Task

A shared unit of work. Its content, dependencies, project labels, and completion state are the same for every profile.

## Daily Plan

A profile's placement and ordering of shared tasks for one logical user day. Focus, Queue, and review outcomes belong to the profile's Daily Plan. Its date is an identifier; the day stays active across midnight until review finishes. Deadline calculations always use the actual calendar date.

## Review

A profile-specific decision pass over that profile's unfinished Daily Plan. Closing tasks, planning the next day, and selecting Focus form one review. Finishing Focus atomically activates the next plan as Today. Correcting the most recent completed review edits the active plan without advancing again.

## Completion

Task completion is shared; its day attribution is recorded separately per profile. A completion belongs to the acting profile's active day, and to each other profile's active day when the task is in that profile's current plan. Old plan membership never implies completion on that day. Repeating completion is idempotent. Reopening removes the completion attribution; completing again records the then-active day. Legacy completions use their recorded calendar timestamp because older backups have no logical-day attribution.
