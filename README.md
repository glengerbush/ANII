<img src="static/icons/app-icon-512.png" alt="ANII icon" width="128" height="128">

# ANII

Self-hosted daily planning with three Focus priorities, a Queue, shared projects, dependencies, and daily review. Optional Ollama integration turns notes into proposed tasks; nothing creates a task until you accept it. Manual features work without AI.

Profiles separate plans and review history, not access: tasks and completion are shared. There is no built-in login. Run on a trusted network or behind an authenticating proxy.

## Docker

Requires Docker Engine with Compose. Published release images target `linux/amd64`.

```sh
cp .env.example .env
# Set LIFE_IMAGE to your published release image; adjust ORIGIN if needed.
docker compose pull
docker compose up -d --wait
```

Open `http://localhost:3000`. Before an image is published, build locally with `docker build -t life-management:local .` and set `LIFE_IMAGE=life-management:local`; skip `pull`.

To update, change `LIFE_IMAGE` to the next release, then repeat `pull` and `up`. Keep the same Compose project and data volume.

- [Docker, Coolify template, Ollama, and native installation](docs/deployment.md)
- [Backups, restore, and rollback](docs/recovery.md)
- [Profiles, tasks, and planning terminology](CONTEXT.md)

## Development

Requires Node 20.19+; the container pins its runtime version.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Verify changes with `npm test`, `npm run check`, and `npm run build`. Tests use disposable databases. Local app data defaults to `data/life.db`.

To publish an image, commit matching versions in `package.json` and `package-lock.json`, then publish GitHub Release `vMAJOR.MINOR.PATCH`. The workflow tests the container and publishes `ghcr.io/<owner>/<repo>:<version>`. Make the GHCR package public for anonymous pulls. No deployment is triggered.

Private research, server notes, and experiments belong in ignored `scratch/`. Public documentation belongs in `docs/`.

## License

[MIT](LICENSE).
