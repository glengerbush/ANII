# Deployment

Use the same versioned Docker image with Docker Compose or Coolify. One app instance owns one SQLite database; stop the old instance before its replacement starts. Updates briefly interrupt service. Ollama is optional and managed separately.

## Docker Compose

Copy `.env.example` to `.env`. Set `LIFE_IMAGE` to a published version or digest, such as `ghcr.io/<owner>/<repo>:0.1.0`.

| Variable | Default | Purpose |
|---|---|---|
| `LIFE_IMAGE` | Required | Versioned app image |
| `ORIGIN` | `http://localhost:3000` | Exact browser origin, without a trailing slash |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface accepting connections |
| `APP_PORT` | `3000` | Published host port |

Run `docker compose pull` followed by `docker compose up -d --wait`. For direct LAN access, use the host's trusted LAN IP for `BIND_ADDRESS` and include it in `ORIGIN`. Behind a proxy, keep the loopback binding and set `ORIGIN` to the browser-facing URL. Changing the host port also requires updating `ORIGIN` when browsing that port directly.

The named volume mounts at `/data`. Keep the same project name and volume on every update. The image runs as UID/GID `1000:1000`; existing bind mounts must be writable by that user. New Docker named volumes inherit the image directory's ownership. Do not use `docker compose down -v` on data you want to retain.

## Coolify template

1. Create a **Docker Compose Empty** resource. Paste [`deploy/coolify/compose.yaml`](../deploy/coolify/compose.yaml), then validate/save.
2. Set **LIFE_IMAGE** to the published version or digest. Set the app domain; route it to internal port **3000**. The template maps Coolify's generated `SERVICE_URL_APP_3000` to the app's `ORIGIN`.
3. Verify `ORIGIN` is the actual browser origin, with no path or trailing slash, then Deploy. Keep one replica. No host port mapping is needed; Coolify's proxy handles access.

The template supplies storage, host-Ollama connectivity, and a 45-second stop grace period. The image supplies its health check. Coolify manages its network, container name, and restart policy.

For an update, change `LIFE_IMAGE`, save, stop the existing Service, then Deploy. Retain the existing resource and volume. The startup lock rejects concurrent processes using the same database; a verified snapshot precedes startup migrations.

Alternatively, create a **Docker Image Application** with port `3000`, `ORIGIN`, a persistent `/data` volume, a 45-second stop timeout, and **Consistent name (no rolling updates)**. Add `--add-host=host.docker.internal:host-gateway` when using host Ollama.

This template can be pasted into Coolify today; it is not an official catalog entry. Once the repository/image exists, replace the metadata's `OWNER/REPO` placeholders. For catalog submission, pin a concrete image version, copy the logo to Coolify's `svgs/` path, and submit the template and matching service documentation. Coolify currently requires 1,000 GitHub stars for catalog eligibility. See [template requirements](https://coolify.io/docs/contribute/service) and [generated URL variables](https://coolify.io/docs/services/configuration/docker-compose).

## Ollama

In **Settings → Local AI**, enter the Ollama server URL and installed model name, then **Test connection** and **Save preferences**.

- Ollama on the Docker host: `http://host.docker.internal:11434` (both supplied templates include the host mapping).
- Ollama in another container: its reachable service hostname on a shared Docker network.
- Native app and native Ollama on the same host: `http://127.0.0.1:11434`.

Host Ollama must listen on an interface reachable from containers. For a systemd installation, `sudo systemctl edit ollama` can add:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Run `sudo systemctl daemon-reload` and `sudo systemctl restart ollama`. Restrict port 11434 to trusted clients/container networks. Ollama needs no public domain. See [Ollama configuration](https://docs.ollama.com/faq).

The optional native installer can provision Ollama with `sudo bash install.sh --ollama-only` on supported hosts. Existing versions/models are retained; drivers remain separately managed. App updates do not update Ollama or its models.

## Native installation

On x86_64 Debian/DietPi with systemd, from a trusted copy of this repository:

```sh
sudo bash install.sh --origin http://SERVER_LAN_IP:3000
```

The installer provisions missing dependencies, Node, Ollama, the initial model, app service, and backups. Rerunning repairs missing setup while preserving data, installed versions, settings, custom services, and models. It does not perform OS/runtime upgrades. Existing origin changes must be made explicitly in `/etc/life-management.env`.

After committing an update, prepare it as a regular user:

```sh
bash deploy/prepare-release.sh HEAD
```

Run the exact activation command printed by preparation. Code lives under `/opt/life-management/releases`; data lives under `/var/lib/life-management`. The deployment stops the app, creates a verified snapshot, activates the release, and checks health. [Recovery instructions](recovery.md).

## Publishing and verification

`npm version 0.1.1 --no-git-tag-version` updates both version files. Commit/push, then publish a matching stable GitHub Release (`v0.1.1`). The workflow builds only `linux/amd64`, runs app/container checks, and publishes that version to GHCR. It refuses to overwrite an existing version and does not deploy automatically.

Repository visibility does not make a GHCR package public; set package visibility separately. Until a release exists, image names in examples are placeholders. Native runtime pins are maintained in `deploy/runtime-versions.json`.

Local container verification:

```sh
docker build -t life-management:check .
bash deploy/check-container.sh life-management:check
```
