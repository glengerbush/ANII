# Android

ANII for Android is a Kotlin/Jetpack Compose client, not a WebView. Install `ANII-<version>.apk` from the GitHub release on Android 8.0 or later. Update your server to **0.6.0 or later** first.

On first launch enter the server root, such as `https://anii.example.com` or `http://192.168.1.20:3000`. The device saves it only after a successful connection. **Settings → Edit server URL** changes it. App restarts, upgrades signed with the same key, and ordinary connection failures preserve the address. Android backup/device transfer includes the connection preference; clearing app storage removes it, and backup restoration depends on the device and backup provider.

Use the server's address on your phone's network, not `localhost` (which means the phone itself). HTTPS uses Android certificate validation; the app never bypasses certificate errors. HTTP supports trusted LAN servers. The app uses ANII's existing shared-profile model, not an additional login. Authenticating proxy login pages are not supported by this first client. Connect through your trusted network/VPN or an appropriate accessible server endpoint; do not expose an unauthenticated server publicly.

## Native UI

- Now, Backlog, Projects, Calendar, and Completed use native lists and navigation.
- Native task sheets edit details, effort, dates, schedule, projects, dependencies, and history.
- Long-press task actions queue/unqueue, move between Focus and Queue, and reorder.
- Native date pickers and a compact month/week calendar with a day agenda; tap an empty date to search and assign a task.
- Capture supports messages, AI proposals, acceptance/dismissal, retry, and deletion. Plan checks remain available in Now.
- Share text from other Android apps to create a task; task mutations provide haptic feedback.
- System light/dark appearance, large touch targets, retained list positions, and Android back navigation.

A connection is required to load and change tasks. Failed mutations are not silently queued or automatically retried. Server administration (AI configuration, backup/restore, export) remains available through the browser link in Settings. All task changes go through the same server actions as the web app.

## Release signing: one-time setup

A release must use the same private key forever to allow in-place upgrades. Never commit signing files. Back them up securely.

Generate once if you do not already have the ANII release key:

```sh
android/scripts/create-signing-key.sh
```

The default directory is `~/.local/share/anii/signing/`. In the repository's **Settings → Secrets and variables → Actions → New repository secret**, create:

| Secret | File whose full contents to paste |
| --- | --- |
| `ANII_KEYSTORE_BASE64` | `~/.local/share/anii/signing/ANII_KEYSTORE_BASE64.txt` |
| `ANII_STORE_PASSWORD` | `~/.local/share/anii/signing/ANII_STORE_PASSWORD.txt` |
| `ANII_KEY_PASSWORD` | `~/.local/share/anii/signing/ANII_KEY_PASSWORD.txt` |

The alias is `anii`. `android/release-certificate.sha256` contains only the public certificate digest; CI rejects a different key. The initial key was generated for this repository; keep it rather than generating a replacement. If recovering this repository on a new computer, restore the original key and passwords from your secure backup.

The release workflow builds/tests/lints the APK and verifies its signature before publishing the container or release. It attaches the APK and SHA-256 checksum to the release, then makes the release public. Missing secrets stop publication. After adding them, use **Actions → Publish web and Android release → Run workflow** on `main` (or rerun the failed release run).

## Build and test

Requires JDK 17, Android SDK Platform 35 / Build Tools 35.0.0. Gradle is pinned by the checked-in wrapper. Android version name/code derive from the root `package.json`; bump it once for both clients.

```sh
./android/gradlew -p android :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

The debug app has a separate application ID, `org.anii.app.debug`, so it cannot replace the signed release or its saved connection.

For a local release build, use the existing signing files without putting passwords into command history:

```sh
export ANII_KEYSTORE="$HOME/.local/share/anii/signing/anii-release.jks"
export ANII_STORE_PASSWORD="$(cat "$HOME/.local/share/anii/signing/ANII_STORE_PASSWORD.txt")"
export ANII_KEY_PASSWORD="$(cat "$HOME/.local/share/anii/signing/ANII_KEY_PASSWORD.txt")"
./android/gradlew -p android :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease
unset ANII_KEYSTORE ANII_STORE_PASSWORD ANII_KEY_PASSWORD
```

For the device smoke test, start a disposable server with `DATABASE_PATH=:memory: npm run dev -- --port 5197`, boot an Android emulator, and run `./android/gradlew -p android :app:connectedDebugAndroidTest`. It verifies first connection, retained settings after recreation/relaunch, task creation/completion, calendar scheduling, project completion/reopening, and that a failed server edit cannot overwrite the saved address.

## JSON API

`GET /api/mobile/<view>` returns an `apiVersion: 1` envelope with profiles, active profile, server date/version/settings, and the view data. Supported views: `now`, `backlog`, `projects`, `project?id=<id>`, `calendar`, `completed`, `settings`, `chat`. Existing view filters are supported.

Mutations use `POST` to the same view with `Content-Type: application/json`, `X-ANII-Client: android-v1`, and `{ "action": "...", "fields": { "id": "..." } }`. Field values are strings. The `life_profile` cookie selects the profile; profile/date validation also applies to mutations. This header identifies the protocol, not authentication. There is no cross-origin browser opt-in. Backups/restores are not part of the mobile mutation surface.
