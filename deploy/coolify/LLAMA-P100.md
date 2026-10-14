# llama.cpp on the 16 GB P100

The working service uses Qwen3.6 35B-A3B UD-Q2_K_XL, stock llama.cpp commit
`7fe450e19305b828c199d602c23a8337aaa1f03b`, and CUDA 12.9.1 built for SM60.
The model includes MTP weights; speculative decoding is disabled.

## Production files

- Local image: `anii-local/llama-p100:stock-28ac872863b7` for the selected build.
- Host model: `/opt/llama/models/35b.gguf`.
- Container model: `/models/35b.gguf`.
- Model SHA-256: `ed7cda7e38985b4fcff76475865135039641d2bfbac3c169df15ca770f37fb0c`.
- Model size: **12,574,128,416 bytes**. A tiny placeholder file is not a model.

Keep the local image and model. They are production dependencies. The image is
not published to a registry: use `pull_policy: never`, retain a `docker image save`
backup elsewhere, and avoid replacing it with an untested CUDA image. Benchmark
scripts and reports are not required for operation.

The Compose mount is:

```yaml
volumes:
  - type: bind
    source: /opt/llama/models/35b.gguf
    target: /models/35b.gguf
    read_only: true
    bind:
      create_host_path: false
```

When relocating the host file, copy and verify the model first, update only
`source`, redeploy, and verify chat and plan checks before deleting the original.
An existing destination file must be verified: a no-clobber copy can silently
leave an invalid placeholder untouched. The container's `-m` argument continues
using `/models/35b.gguf`.

## Coolify configuration

Keep the existing service's GPU UUID reservation and join the external network
shared with ANII (`life-ai` on the current server), with alias `anii-llama`.
Listen on internal port 11434. No host port or public domain is needed. Keep the
shared network when deleting other resources.

The tested server arguments are:

```text
-m /models/35b.gguf --host 0.0.0.0 --port 11434
--alias qwen3.6-35b-a3b -ngl all --ctx-size 8192 --parallel 1
--fit off --batch-size 512 --ubatch-size 256 --temp 0 --seed 42
--predict 2048 --flash-attn on --cache-type-k f16 --cache-type-v f16
--cache-ram 0 --jinja --metrics --reasoning-format deepseek
--spec-type none --spec-draft-n-max 4 --spec-draft-p-min 0.75
--chat-template-kwargs '{"enable_thinking": false}'
```

The health check must require HTTP 200 from `/health`. The selected runtime
contains Bash but no curl, wget or Python; its generated Compose uses Bash TCP
support for the check. Retain the start period while the model loads.

## ANII Settings

- AI server URL: `http://anii-llama:11434` (a `/v1` suffix is also accepted).
- Model alias: `qwen3.6-35b-a3b`.
- Request timeout: 300 seconds, allowing multiple task searches.

Test connection, save preferences, then verify a chat request referring to an
existing task and run **Check plan**. Model discovery alone does not prove
successful generation. ANII sends temperature 0, seed 42 and prompt-cache reuse
off, matching the comparison. The server controls thinking and output capacity.

## Preparing from a retained benchmark workspace

`prepare-llama.py` is optional tooling for a finalized workspace that still has
`selected.json`, `start-selected.sh`, the model and the retained Docker image.
It verifies the model and image, adds a production tag, and generates Compose
using the recorded flags. It does not start/stop services or download anything.

```bash
python3 prepare-llama.py --app-container YOUR_ANII_CONTAINER --network life-ai
```

The generated mount initially points inside the benchmark workspace. Relocate
and verify that file as above before removing the workspace. After cleanup, use
the saved production Compose; the preparation helper no longer has its inputs.

References: [Coolify Compose networking](https://coolify.io/docs/applications/builds/docker-compose),
[Docker GPU reservations](https://docs.docker.com/compose/how-tos/gpu-support/),
[tested llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/README.md).
