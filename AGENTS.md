# AGENTS.md — everos-opencode

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

### Options (via `"plugins": [{ "package": "everos-opencode", "options": {...} }]`)

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
- `npm run test:integration` — placeholder; real EverOS harness comes later
