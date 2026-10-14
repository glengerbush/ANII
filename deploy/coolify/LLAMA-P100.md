# Replace Ollama with the selected P100 server

This uses the finalized `35b-stock-mtp-off` image and model already on the server.
No rebuild or model download. Requires ANII 0.4.6 or later for llama.cpp support.

## Prepare

Copy `prepare-llama.py` to the server. Run it with the current ANII container name
from `docker ps --format '{{.Names}}'`:

```bash
python3 prepare-llama.py --app-container app-aasbldbktj8lfoxsixzxzzys
cat llama-coolify.yaml
```

The script verifies the model checksum and retained image, reuses the finalized
launch arguments, and gives the image a production tag. It only changes the
internal listening port to 11434 and adds the model alias `qwen3.6-35b-a3b`.
It detects ANII's Docker network; if ambiguous, rerun with `--network NAME` from
the listed choices. Rerunning is safe. Nothing starts, stops, downloads, or gets
deleted. Python uses only its standard library.

## Deploy in Coolify

1. Update ANII to the release containing llama.cpp support. Keep its existing
   database volume and configuration. Back up its data in Settings first.
2. Stop Ollama in Coolify to free GPU memory. Keep its resource and volume for
   rollback until verification succeeds. Stop any manually launched benchmark
   server too. **Do not run `start-selected.sh` alongside the Coolify service.**
3. Add a **Docker Compose Empty** resource on the same server. Name it `llama.cpp`.
   Paste `llama-coolify.yaml` into its Compose editor. Leave domains and published
   ports empty. The file already joins ANII's existing network using an explicit
   alias, so no ANII network edit or Traefik change is needed.
4. Deploy. Use the local image (`pull_policy: never`); don't replace it with a
   current CUDA image or invoke a forced image pull. The retained CUDA 12.9 P100
   build is what was benchmarked. Allow several minutes for initial loading.
5. ANII → Settings → Local AI:
   - Provider: **llama.cpp**
   - URL: **http://anii-llama:11434**
   - Test connection. The sole model **qwen3.6-35b-a3b** is selected automatically.
   - Timeout: **300 seconds**, allowing multiple task searches.
   - Save preferences.
6. Test a chat message referencing an existing task, review its dependency
   proposal, then run **Check plan**. Connection discovery alone does not test
   generation or tool calls.
7. Once both work, remove the stopped Ollama resource. Its old downloaded models
   remain until you separately remove **only its Ollama data volume** in Coolify.
   Never remove ANII's data volume. No host Ollama uninstall is needed for a
   container-only installation.

The service health check uses Bash's built-in TCP support: the retained image
has no curl, wget, or Python. `/health` must return HTTP 200, not merely have a
running process. GPU access uses the exact UUID recorded in `selected.json`.

## Retained configuration and ownership

The model is Qwen3.6 35B-A3B UD-Q2_K_XL (MTP-capable weights, speculation off).
The selected launch settings normally use 8,192 context, one parallel slot,
full GPU offload, F16 KV cache, flash attention on, temperature 0, seed 42,
2,048 output tokens and thinking off. The generated file takes the actual
settings from `start-selected.sh`; inspect it if a different run was selected.
ANII uses temperature 0, seed 42 and prompt-cache reuse off, matching the quality
comparison. Server defaults control thinking and the generation token limit.

The model remains mounted read-only from the benchmark directory. **Keep
`/root/.local/share/anii-ai-bench/models/35b.gguf`**. Deleting that directory
would delete your production model. Keep reports/ratings and the generated
Compose as records. The temporary script-copy folder can be removed afterward.

The production image tag and running Coolify container retain the selected
image. To back it up before future image pruning, run `docker image save -o
llama-p100-image.tar IMAGE_TAG`, substituting the tag printed by the script.
The local image is not published to a registry.

To roll back: stop llama.cpp first, restart the retained Ollama resource, then
restore ANII's previous provider, URL and model in Settings. This does not alter
tasks, chat history, or proposals. Removing the new Coolify resource later leaves
the bind-mounted model intact; it can be deleted separately when no longer used.

References: [Coolify Compose networking](https://coolify.io/docs/applications/builds/docker-compose),
[Docker GPU reservations](https://docs.docker.com/compose/how-tos/gpu-support/),
[tested llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/README.md).
