# Release build performance

Manual benchmarking: dispatch `release.yml` on `main` with `benchmark=true`.
It runs the same signed Android checks and web/container checks, but the publication
job is disabled. Detection uses the original release revision when the current
version is already tagged, so a benchmark cannot replace a published version.
The publisher now uses Buildx's `docker` driver for registry inspection instead of
starting a separate BuildKit container. Web builds still use their cached builder.

The first [warm benchmark](https://github.com/glengerbush/ANII/actions/runs/43472729825)
passed in **1m08s** on 2026-11-13. Android took **56s** (Gradle itself: 24s), versus
2m49s in the cold 0.7.3 release; web took **39s**, versus 1m36s. Publication was
confirmed skipped, so 1m08s is qualification/signing time, not full release time.
This reused the unchanged 0.7.3 code; source/version changes may invalidate some
task outputs. Docker-driver registry inspection was also verified locally against
the published 0.7.3 image without creating a separate BuildKit container.

Android and web qualification run independently after version detection. Publication
requires both jobs to pass. Android still runs release unit tests, lint, signing
certificate verification and APK signature verification. The Dockerfile still runs
all web checks; the web job also checks real container persistence and backups.

The web job exports its tested image as a checksummed artifact. Publication verifies
the checksum and source revision and loads that artifact instead of rebuilding it.
When repairing an existing release, the registry image's revision and container
checks are verified again before reuse. Existing version ownership, APK attachment
ordering, publication serialization and latest-version protection remain unchanged.

Gradle dependencies, wrapper downloads and task outputs are cached. `--build-cache`
enables reuse of eligible task outputs; signing material remains in the runner's
temporary directory and is removed by the existing trap.

## Hosted measurement — 2026-11-13

The [0.7.3 release](https://github.com/glengerbush/ANII/actions/runs/43464641279)
succeeded in **3m40s**, from workflow creation through completion, including signing
and publication. The previous [0.7.2 release](https://github.com/glengerbush/ANII/actions/runs/42550763108)
took **5m01s**: an **81-second / 27% reduction**. Other recent baselines ranged from
4m55s to 6m40s; runner and cache variability still affect future results.

| Job | 0.7.2 | 0.7.3 |
| --- | --- | --- |
| Android qualification/signing | 2m47s | 2m49s |
| Web qualification | Within publication | 1m36s, alongside Android |
| Publication | 2m02s | 36s |

The measured improvement comes from moving web qualification off the serial
publication path. All existing checks remain. The release includes the signed APK
and checksum; the versioned and `latest` container images were published successfully.

Validation: 12 release tests pass, plus workflow graph/artifact-gate checks and
actionlint. The installed actionlint 1.7.12 does not recognize the pre-existing
GitHub `concurrency.queue` field; only that existing diagnostic is excluded.

```sh
python3 -m unittest discover -s deploy -p 'test_release_*.py'
```
