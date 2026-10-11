#!/usr/bin/env bash
# Run on the server. Rollback changes code only; see docs/recovery.md.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
base=/opt/life-management
state=/var/lib/life-management
service=life-management.service
exec 9>/run/lock/life-management-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[[ -f /etc/life-management.env ]] || { echo 'Install the service and configure ORIGIN first.' >&2; exit 1; }
if grep -q REPLACE_WITH /etc/life-management.env; then
  echo 'Configure the real browser origin using the server LAN address first.' >&2
  exit 1
fi

if [[ ${1:-} == --rollback && $# == 2 ]]; then
  [[ $2 =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}-[A-Za-z0-9]+$ ]] || { echo 'Invalid release ID.' >&2; exit 1; }
  target=$base/releases/$2
  [[ -d $target && ! -L $target ]] || { echo 'Release not found.' >&2; exit 1; }
elif [[ $# == 1 && -d $1 ]]; then
  source_dir=$(realpath "$1")
  commit=$(cat "$source_dir/RELEASE")
  [[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit ID.' >&2; exit 1; }
  for entry in build drizzle node_modules package.json package-lock.json; do
    [[ -e $source_dir/$entry ]] || { echo "Missing $entry" >&2; exit 1; }
  done
  install -d -m 0755 "$base/releases"
  target=$(mktemp -d "$base/releases/$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}-XXXXXXXX")
  cp -a "$source_dir"/{build,drizzle,node_modules,package.json,package-lock.json,RELEASE} "$target/"
  chown -hR root:root "$target"
  chmod -R a+rX,go-w "$target"
else
  echo 'Usage: activate-release.sh PREPARED_DIRECTORY | --rollback RELEASE_ID' >&2
  exit 1
fi
[[ -f $target/build/index.js && -f $target/drizzle/0000_initial.sql ]] || { echo 'Incomplete release.' >&2; exit 1; }
old=$(readlink -f "$base/current" || true)
was_active=false
if systemctl is-active --quiet "$service"; then was_active=true; fi
phase=before-stop
on_error() {
  code=$?
  trap - ERR INT TERM
  if [[ $phase == starting ]]; then
    systemctl stop "$service" || true
    echo "Activation failed. Service stopped; database retained. Previous release: ${old:-none}" >&2
    echo "Pre-deploy snapshot: ${snapshot:-none}. See docs/recovery.md for recovery." >&2
  elif [[ $phase == stopped && $was_active == true ]]; then
    systemctl start "$service" || true
  fi
  exit "$code"
}
trap on_error ERR
trap 'false' INT TERM
systemctl stop "$service"
phase=stopped
snapshot=none
if [[ -f $state/life.db ]]; then
  snapshot=$(/usr/bin/python3 /usr/local/lib/life-management/backup.py "$state/life.db" "$state/deploy-backups")
fi
echo "Pre-deploy snapshot: $snapshot"
# Once the link changes, the new code might migrate the database. Never restore automatically.
phase=starting
ln -sfnT "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl reset-failed "$service"
systemctl start "$service"
healthy=false
for attempt in {1..30}; do
  if systemctl is-active --quiet "$service" && [[ $(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 http://127.0.0.1:3000/today) == 200 ]]; then
    healthy=true
    break
  fi
  sleep 1
done
[[ $healthy == true ]]
trap - ERR INT TERM
printf 'Live release: %s\nPrevious release: %s\n' "${target##*/}" "${old:-none}"
echo 'Now verify task creation and completion at the configured LAN URL, including remote access through the router.'
