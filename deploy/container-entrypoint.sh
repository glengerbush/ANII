#!/bin/sh
set -eu
umask 077
: "${DATABASE_PATH:=/data/life.db}"
export DATABASE_PATH
case "$DATABASE_PATH" in
  /*) ;;
  *) echo 'DATABASE_PATH must be an absolute path on persistent storage.' >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$DATABASE_PATH")"
# Keep the lock through exec and until the Node process exits, including migrations.
exec flock --exclusive --nonblock --no-fork "$(dirname "$DATABASE_PATH")/.life-management.lock" \
  node "$(dirname "$0")/container-start.mjs"
