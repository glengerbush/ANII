<img src="static/icons/app-icon-512.png" alt="ANII icon" width="128" height="128">

# ANII

Self-hosted daily planning with three Focus priorities, a Queue, shared projects, dependencies, and week/month calendars. Optional llama.cpp integration turns notes into proposed tasks; nothing creates a task until you accept it. Manual features work without AI.

Profiles separate queues and assignments, not access: tasks and completion are shared. There is no built-in login. Run on a trusted network or behind an authenticating proxy.

## Docker

Requires Docker Engine with Compose. Published release images target `linux/amd64`.

```sh
cp .env.example .env
# Set LIFE_IMAGE to your published release image; adjust ORIGIN if needed.
docker compose pull
docker compose up -d --wait
```

Open `http://localhost:3000`. Before an image is published, build locally with `docker build -t life-management:local .` and set `LIFE_IMAGE=life-management:local`; skip `pull`.

To update, change `LIFE_IMAGE` to the next release, then repeat `pull` and `up`. Or use `ghcr.io/<owner>/<repo>:latest` to get the newest stable release on each pull. Keep the same Compose project and data volume.

- [Docker, Coolify template, llama.cpp, and native installation](docs/deployment.md)
- [Backups, restore, and rollback](docs/recovery.md)
- [Profiles, tasks, and planning terminology](CONTEXT.md)

## Development

Requires Node 20.19+; the container pins its runtime version.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Verify changes with `npm test`, `npm run check`, and `npm run build`. Tests use disposable databases. Local app data defaults to `data/life.db`.

To release, run `npm version patch --no-git-tag-version`, then commit and push to `main`. A version bump automatically tests the container, publishes `ghcr.io/<owner>/<repo>:<version>` and `:latest`, and creates GitHub Release `v<version>` with generated notes. Make the GHCR package public for anonymous pulls. Deployment remains manual.

Private research, server notes, and experiments belong in ignored `scratch/`. Public documentation belongs in `docs/`.

## License

[MIT](LICENSE).

## Scheduling

Now follows the actual date in Settings’ timezone (`local` uses the server timezone). Each task has one start date and one assignee, or Everyone. It stays eligible from that date until completed. Removing it from Now hides it only for that profile and date. Additions from Backlog or Now begin today and are assigned to the current profile.

Calendar offers week/month views and shows tasks only on their start date. Click a day to search existing tasks; click a result to assign it to yourself, or use its assignee menu. Click an entry to reschedule or remove its schedule.

The first startup after this change saves `backups/life-before-calendar-*.db`, converts active/future plans to schedules, and removes Review data. Existing work shared across multiple profiles becomes an Everyone assignment. Completion history is retained. JSON exports use version 4; restore accepts only the current schema.

Backlog ordering is personal to each profile. Queued-up tasks stay above unqueued tasks; drag within either group using the handle, or use Space, arrow keys, and Space again. Queue up appends to the queued group; Unqueue puts the task first among unqueued tasks and hides it only for that day. Now’s Queue shares this order; Focus keeps its own order. Reordering a filtered list preserves the relative order of tasks outside the filter.

Project task order is shared by all profiles and independent of personal queues. Drag tasks within a project, or use Space and arrow keys on the handle. New project tasks append to the end; the project card’s Next task follows this order, skipping blocked tasks.

New tasks start at the top of the unqueued group. Scheduled tasks entering Now, including tasks returning after a one-day hide, join the end of the queued group. Hidden tasks retain their Focus preference; if three other tasks already occupy Focus when they return, they enter Queue.

Personal placement is persistent, separate from date eligibility. The planning module owns schedule changes, visibility, order, Focus capacity, and completion attribution. Startup also converts the earlier calendar preview’s daily rows into persistent placement and removes the old daily-plan triggers. Current snapshots preserve placement and restore without historical Focus constraints.
