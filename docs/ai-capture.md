# Local AI capture and plan checks

ANII uses llama.cpp's OpenAI-compatible API: `/v1/models` for discovery and streamed `/v1/chat/completions` for generation. Capture requires native tools and structured JSON. Configure the server URL and model in Settings; a single available model is displayed without a selector. Model loading, memory residency, context capacity, and thinking are server settings.

Existing installation and backup settings are migrated to `ai_url`; obsolete provider and memory controls are removed. Fresh installs suggest the alias `qwen3.6-35b-a3b`. Set the alias your server actually exposes. See the [P100 operations guide](../deploy/coolify/LLAMA-P100.md).

Capability/connection/timeout errors retain the saved message. Retry AI uses that message and current settings. Check plan reports completion, including zero concerns, and keeps deterministic deadline results when AI fails.

Chat now includes up to 12 recent messages and proposal outcomes, within a 12,000-character history budget. It does not load the entire task database into each prompt. The model chooses read-only tools:

- `search_tasks`: literal word search in task titles/notes; project ID and open/completed/blocked/all filters; up to 10 compact results, offset pagination.
- `get_tasks`: details for up to 8 IDs; notes capped at 2,000 characters with a truncation flag.
- `get_dependencies`: prerequisites/dependents for up to 8 IDs, 20 edges per direction with truncation flags.
- `search_chat_history`: older message snippets and proposal outcomes, up to 10 results with cursor pagination.

Search uses bounded SQLite lexical `LIKE` queries, with literal wildcard escaping. This keeps the local schema and backup format simple; it is not semantic search, embeddings, or an FTS index. Each query intersects its words; the model can try alternative wording. Returned snippets center on matched text.

Capture has at most four lookup rounds, eight calls per round, 40,000 characters of conversation context, and the saved Settings timeout across the whole run. Independent calls run together; identical validated arguments reuse cached results. Individual tool output is capped at 4,500 characters with visible truncation. The current message is limited to 12,000 characters for AI processing (longer messages remain saved). Project hints include up to 40 names. If a lookup or context limit prevents a reliable answer, the model must ask for clarification rather than guess.

The application streams actual request/tool events, elapsed time, and any `delta.reasoning_content` text the selected model emits. Thinking is expandable and labeled as model-generated text; availability depends on the model. ANII does not invent progress percentages or expose an internal application reasoning trace. It uses the server’s configured thinking mode. Disconnecting aborts provider work; the database restore gate remains held until that work settles.

## Reviewable change sets

Capture proposes this JSON shape; fields omitted here are optional/defaulted:

```json
{
  "message": "Review these tasks and their required dependency.",
  "clarification": false,
  "tasks": [
    {"ref": "new1", "title": "Prepare materials", "details": "", "projectId": null, "duration": "30m", "dueAt": null},
    {"ref": "new2", "title": "Build the shelf"}
  ],
  "dependencies": [
    {"task": "new1", "prerequisite": 42},
    {"task": "new2", "prerequisite": "new1"},
    {"task": 73, "prerequisite": "new2"}
  ]
}
```

An endpoint is an existing numeric task ID verified by lookup, or a new task's local `ref`. `task` depends on `prerequisite`; all links are required. New/new, existing/new and new/existing directions work. Limits: 10 new tasks and 20 links. Ambiguous references should produce `clarification: true`, a concise question, and no changes.

Nothing applies until **Accept changes**. ANII checks IDs, projects, duplicate links and cycles, checks again at acceptance, then creates all tasks and links atomically. Any failure rolls back the entire change set. Existing standalone proposals still work; accepting new changes does not alter previously accepted tasks except for explicitly proposed dependency links. Dismissing leaves tasks untouched.

For transport/UI verification without a model, run `node tests/fixtures/ai/mock-llama.mjs` and point a disposable test database's AI server URL at `http://127.0.0.1:11435`. The fixture emits thinking, a lookup, a task/dependency proposal, and zero-concern plan checks. It is not evidence of live-model extraction quality.

API reference: [tested llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/README.md).
