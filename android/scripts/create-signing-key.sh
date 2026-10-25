#!/usr/bin/env bash
set -euo pipefail
umask 077
signing_dir="${1:-$HOME/.local/share/anii/signing}"
mkdir -p "$signing_dir"
if [ -e "$signing_dir/anii-release.jks" ]; then
  echo "Signing key already exists at $signing_dir; keeping it."
  exit 0
fi
openssl rand -hex 32 > "$signing_dir/ANII_STORE_PASSWORD.txt"
cp "$signing_dir/ANII_STORE_PASSWORD.txt" "$signing_dir/ANII_KEY_PASSWORD.txt"
keytool -genkeypair -keystore "$signing_dir/anii-release.jks" -storetype JKS -alias anii \
  -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=ANII Android Release' \
  -storepass:file "$signing_dir/ANII_STORE_PASSWORD.txt" -keypass:file "$signing_dir/ANII_KEY_PASSWORD.txt" >/dev/null 2>&1
base64 -w 0 "$signing_dir/anii-release.jks" > "$signing_dir/ANII_KEYSTORE_BASE64.txt"
echo "Created private signing files in $signing_dir. Back up this directory securely; future app updates require the same key."
