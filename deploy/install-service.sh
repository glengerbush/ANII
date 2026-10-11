#!/usr/bin/env bash
# Advanced service-only setup; normal first install uses ../install.sh.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
exec /usr/bin/python3 "$(dirname "$(realpath "$0")")/setup.py" --services-only "$@"
