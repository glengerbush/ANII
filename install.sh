#!/usr/bin/env bash
# Run from a trusted copy of this project on the DietPi host.
set -Eeuo pipefail
if [[ ${1:-} == --help ]]; then
  echo 'Usage: sudo bash install.sh --origin http://SERVER_LAN_IP:3000'
  echo 'Coolify/Docker: sudo bash install.sh --ollama-only (native Ollama only; see docs/deployment.md)'
  echo 'Rerun the same command to repair setup; existing data, configuration and versions are retained.'
  exit 0
fi
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ -f /etc/debian_version && $(uname -m) == x86_64 && -d /run/systemd/system ]] || {
  echo 'This installer requires x86_64 DietPi/Debian with systemd.' >&2; exit 1;
}
export PATH=/opt/life-management/runtime/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if ! command -v python3 >/dev/null; then
  apt-get update
  apt-get install --yes --no-upgrade python3
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else "Python 3.9+ is required; upgrade the host OS first.")'
exec python3 "$(dirname "$(realpath "$0")")/deploy/setup.py" "$@"
