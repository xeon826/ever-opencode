# AGENTS.md — ever-opencode

Persistent-memory plugin for OpenCode V2 backed by a local EverOS server.

## Spec

The authoritative implementation plan lives **outside this repo** at
`~/.opencode/plan/everos-opencode-plugin.md`. Read it before making
behavioral changes.

## Commit policy (project override)

The global "no autonomous commits" rule is **WAIVED for this repo only**: the
orchestrator agent may commit autonomously so history shows clean project
progression.

- Conventional Commits: `feat:` / `test:` / `ci:` / `docs:` / `chore:`
- Subjects: imperative, ≤72 chars, one logical unit per commit
- Docs updated in the same commit as the change they describe
- **Push only on request** — commits stay local until the user asks
- The orchestrator owns git: implementation lanes prepare the tree, not commits

## Configuration

### Options (via `"plugins": [{ "package": "ever-opencode", "options": {...} }]`)

| Option        | Default                 | Meaning                                   |
| ------------- | ----------------------- | ----------------------------------------- |
| `everosUrl`   | `http://127.0.0.1:8000` | EverOS server base URL                    |
| `flushEvery`  | `3`                     | Flush memory every N captured turns       |
| `topK`        | `5`                     | Max recall episodes injected              |
| `recallMethod`| `keyword`               | `keyword` (no embeddings) / `hybrid` / `agentic` |
| `enabled`     | `true`                  | Master switch                             |
| `logLevel`    | `info`                  | `debug` / `info` / `error` / `silent`     |

### Environment (beats option defaults; explicit option beats env)

| Env var           | Overrides            |
| ----------------- | -------------------- |
| `EVEROS_URL`      | `everosUrl`          |
| `EVEROS_USER_ID`  | user identity        |
| `EVEROS_APP_ID`   | app scope (default `opencode`) |

## Build & test

- `npm run build` — tsc → `dist/` (ESM, NodeNext; imports need `.js` extensions)
- `npm test` — vitest unit + contract tests (hermetic, no network)
- `npm run test:integration` — live harness (`EVEROS_INTEGRATION=1`): health → add → flush →
  search round-trip against the real server; writes land in a throwaway `everos-integration-*`
  app scope; skips automatically when the server is down

## Agent tools (V2 `ctx.tool.transform`)

Registered when the host exposes `ctx.tool` (see `src/tools.ts`; structural JSON-Schema tool
defs, no SDK runtime import):

- `everos_search` — on-demand recall: query episodes server-side (BM25/vector), project scope
  by default, `scope: "global"` widens; `top_k` clamps 1–25
- `everos_add` — store one fact now: add (deferred) + synchronous flush; extraction is LLM-side,
  search indexes may lag the flush return by a few seconds (copy on the tool says so)
- `everos_flush` — force extraction of the session's deferred capture buffer

Errors from the EverOS server surface as tool-result content (`everos_* failed: <code>: msg`),
never as thrown tool errors.

## Dev sandbox (project-local testing)

`~/git_clones/everos-sandbox/opencode.jsonc` loads this clone via a local `plugins` path entry
(`logLevel: debug`, `flushEvery: 2`). Workflow: edit → `npm run build` → restart the sandbox
session → exercise tools. Captures land in the `everos-sandbox` scope under `~/.everos/opencode/`,
isolated from real project memory. Do not add the dev path to the global config.
