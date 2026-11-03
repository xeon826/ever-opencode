# everos-opencode

Persistent memory plugin for [OpenCode](https://docs.opencode.ai) V2, backed by a
local [EverOS](https://pypi.org/project/everos/) server. Capture every turn,
inject relevant recall into future turns — zero agent discipline required.

Local-first, free, provider-neutral: the plugin is an **LLM-free HTTP client**.
It never loads an SDK, never sees an API key, and makes zero model calls. All
provider choice lives in the EverOS server config.

## How it works

- **Capture** — on each completed assistant turn (`session.text.ended`), the
  plugin reads the new transcript messages and posts them to the EverOS server
  with deferred extraction (buffered, no LLM at capture time). Fire-and-forget;
  turn end is never blocked.
- **Recall** — on each new user message, the plugin searches EverOS for
  relevant episodes and pushes a compact recall block into the system context.
  Deduped per user message so a single search runs per turn.
- **Flush** — extraction runs when the Nth capture lands (`flushEvery`, default
  3) and always before compaction, so episodes exist before the transcript is
  summarized.
- **Storage** — episodes land on disk as human-readable Markdown at
  `~/.everos/<app>/<project>/users/<user_id>/episodes/episode-<date>.md`.

The agent never has to "remember to save". Server down? Sessions degrade
gracefully — the plugin logs once and stays a silent no-op.

## Quickstart (30 seconds)

### 1. Install and start EverOS

Requires Python 3.12+.

```sh
uv tool install everos        # or: pip install everos
everos init                   # writes ~/.everos/everos.toml
```

Point `[llm]` at any OpenAI chat-completions-compatible endpoint, e.g. Ollama
(local and free):

```toml
[llm]
model    = "openai/llama3.1"
api_key  = "ollama"                      # ignored by Ollama, but must be set
base_url = "http://localhost:11434/v1"
```

Start the server:

```sh
everos server start           # serves http://127.0.0.1:8000
curl http://127.0.0.1:8000/health   # → {"status":"ok"}
```

### 2. Install the plugin

Add it to your OpenCode config's `plugins` array:

```json
{
  "plugins": ["everos-opencode"]
}
```

Or with options:

```json
{
  "plugins": [
    {
      "package": "everos-opencode",
      "options": {
        "everosUrl": "http://127.0.0.1:8000",
        "flushEvery": 3,
        "topK": 5,
        "recallMethod": "keyword",
        "enabled": true,
        "logLevel": "info"
      }
    }
  ]
}
```

### 3. Talk

Have a conversation, then check episodes on disk:

```sh
ls ~/.everos/opencode/<project>/users/<you>/episodes/
```

Future sessions in the same project recall what happened in past ones.

## EverOS `[llm]` provider matrix

Any OpenAI-protocol chat-completions endpoint works. Copy-paste TOML for
`~/.everos/everos.toml`:

| Provider | Notes |
| --- | --- |
| OpenAI | The reference endpoint. |
| OpenRouter | One key, hundreds of models. |
| Z.ai | GLM coding endpoint. |
| Ollama | Local, free, no key. |

```toml
# OpenAI
[llm]
model    = "openai/gpt-4o-mini"
api_key  = "sk-..."
base_url = "https://api.openai.com/v1"

# OpenRouter
[llm]
model    = "openai/anthropic/claude-3.5-haiku"
api_key  = "sk-or-..."
base_url = "https://openrouter.ai/api/v1"

# Z.ai coding endpoint
[llm]
model    = "glm-5.3-flash"
api_key  = "..."
base_url = "https://api.z.ai/api/coding/paas/v4"

# Ollama (local, free)
[llm]
model    = "openai/llama3.1"
api_key  = "ollama"
base_url = "http://localhost:11434/v1"
```

Any other OpenAI-compatible `base_url` (llama.cpp, vLLM, DeepInfra, Azure
OpenAI, …) should work the same way. Non-OpenAI endpoints are
**reported-working, not guaranteed** — endpoint quirks vary.

Requirements: the endpoint must expose OpenAI **chat completions**
(`/chat/completions`). Responses-API-only endpoints are not supported.
An optional `[embedding]` section unlocks hybrid search and agentic recall.

## Configuration

Plugin options (all optional, via the `plugins` entry):

| Option        | Default                 | Meaning                                   |
| ------------- | ----------------------- | ----------------------------------------- |
| `everosUrl`   | `http://127.0.0.1:8000` | EverOS server base URL                    |
| `flushEvery`  | `3`                     | Flush memory every N captured turns       |
| `topK`        | `5`                     | Max recall episodes injected              |
| `recallMethod`| `keyword`               | `keyword` (no embeddings) / `hybrid` / `agentic` |
| `enabled`     | `true`                  | Master switch                             |
| `logLevel`    | `info`                  | `debug` / `info` / `error` / `silent`     |

Environment overrides (beat option defaults; explicit options beat env):

| Env var           | Overrides            |
| ----------------- | -------------------- |
| `EVEROS_URL`      | `everosUrl`          |
| `EVEROS_USER_ID`  | user identity        |
| `EVEROS_APP_ID`   | app scope (default `opencode`) |

## Recall methods

| `recallMethod` | Requires | When to use |
| --- | --- | --- |
| `keyword` (default) | Nothing | Fresh installs; works before embeddings exist. |
| `hybrid` | `[embedding]` configured in EverOS | Better semantic matching. |
| `agentic` | `[embedding]` + a rerank-capable model | Highest quality, slowest. |

The default is `keyword` so a fresh install works out of the box.

## Troubleshooting

- **Nothing is being remembered.** Is the server up? When it's down the plugin
  is a silent no-op (one stderr log per session). Verify:
  `curl http://127.0.0.1:8000/health` → `{"status":"ok"}`.
- **Inspect what's stored.** Episodes are plain Markdown:
  `~/.everos/opencode/<project>/users/<user_id>/episodes/`.
- **Just-flushed turns don't show up in recall.** The search index lags
  ~10–15 seconds after a flush. Same-session recall of just-captured turns may
  miss; later sessions are fine.
- **Server comes back mid-session?** Sessions marked degraded retry on the
  next opportunity; restarting the OpenCode session re-arms capture cleanly.

## Limitations

- **Project identity is the working-directory basename.** OpenCode V2 exposes
  no git remote to the plugin, so two sibling projects with the same folder
  name could collide in EverOS scoping.
- **Chat-completions endpoints only.** EverOS extraction needs an
  OpenAI-compatible `/chat/completions` endpoint; responses-API-only endpoints
  are unsupported.
- **~10–15s index lag** after each flush; search may not see just-flushed
  episodes immediately.
- **No redaction.** Raw transcript text is extracted and stored locally in
  `~/.everos/`. Keep that in mind for sensitive sessions — everything stays on
  your machine, but it is stored verbatim.

## FAQ

**How is this different from mem0's OpenCode plugin?**

- **Local vs cloud.** Everything runs on your machine; transcripts never leave
  it. mem0 routes through its platform.
- **Free vs metered.** EverOS + your own provider (e.g. Ollama) costs nothing;
  mem0 meters per operation.
- **Bring any provider vs their allowlist.** EverOS accepts any
  OpenAI-compatible endpoint; mem0 restricts to their supported BYOK list.

**How is this different from a curated doc brain (AGENTS.md, Operator, CLAUDE.md)?**

Complementary, not competing. Curated docs are **standing truth** you author
deliberately: conventions, invariants, decisions. This plugin provides
**episodic recall**: what actually happened in past sessions, captured
automatically. Standing truth tells the agent what should be true; episodes
tell it what was.

## License

Apache-2.0 — matches EverOS.
