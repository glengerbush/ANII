#!/usr/bin/env bash
# Uses only disposable named volumes/containers. Requires an accessible Docker daemon.
set -euo pipefail
image=${1:?Usage: check-container.sh IMAGE}
name="life-check-$$"
volume=$(docker volume create)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker rm -f "$name-contender" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null
}
trap cleanup EXIT
start() {
  docker run -d --name "$name" --mount "source=$volume,target=/data" \
    -e ORIGIN=http://life.example.test "$image" >/dev/null
  for attempt in {1..60}; do
    if docker exec "$name" node deploy/container-healthcheck.mjs; then return; fi
    sleep 1
  done
  docker logs "$name"
  return 1
}
start
docker exec "$name" node --input-type=module -e '
  import Database from "better-sqlite3";
  const db = new Database("/data/life.db");
  db.exec("CREATE TABLE deployment_probe (value TEXT); INSERT INTO deployment_probe VALUES ('\''retained'\'')");
  db.close();
'
# A competing app sharing this data must exit before migration or backup.
status=0
timeout 15 docker run --rm --name "$name-contender" --mount "source=$volume,target=/data" \
  -e ORIGIN=http://life.example.test "$image" || status=$?
if [[ $status != 1 ]]; then
  echo "Expected lock rejection (exit 1), got $status." >&2
  exit 1
fi
docker stop --time 45 "$name" >/dev/null
docker rm "$name" >/dev/null
start
docker exec "$name" node --input-type=module -e '
  import assert from "node:assert/strict";
  import Database from "better-sqlite3";
  import { readdirSync } from "node:fs";
  const files = readdirSync("/data/deploy-backups");
  assert.equal(files.length, 1);
  for (const path of ["/data/life.db", "/data/deploy-backups/" + files[0]]) {
    const db = new Database(path, { readonly: true });
    assert.equal(db.prepare("SELECT value FROM deployment_probe").pluck().get(), "retained");
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    db.close();
  }
'
echo 'Container startup, exclusive lock, persistent data and pre-start backup passed.'
