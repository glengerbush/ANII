#!/usr/bin/env bash
# Run as a regular user on the DietPi server, from a trusted Git checkout.
set -Eeuo pipefail
export PATH=/opt/life-management/runtime/node/bin:/usr/local/bin:/usr/bin:/bin
if (( EUID == 0 )); then
  echo 'Run preparation as a regular user; npm scripts must not run as root.' >&2
  exit 1
fi
ref=${1:-HEAD}
commit=$(git rev-parse --verify "$ref^{commit}")
release=$(mktemp -d /var/tmp/life-release.XXXXXXXX)
trap 'echo "Preparation failed; inspect/remove $release" >&2' ERR
git archive "$commit" | tar -x -C "$release"
cd "$release"
printf '%s\n' "$commit" > RELEASE
export DATABASE_PATH=:memory:
python3 -B -m unittest discover -s deploy -p 'test_*.py'
npm ci
npm test
npm run check
npm run build
npm prune --omit=dev
printf '\nPrepared commit %s at %s\nActivate with: sudo bash deploy/activate-release.sh %q\n' "$commit" "$release" "$release"
