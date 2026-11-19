# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-19

### Fixed

- `everos_search`: removed the `scope: "global"` option — it never worked. The
  EverOS v2 search API pins `app_id`/`project_id` (defaults `"default"`) into
  the store filter, so a request without narrowing searches an empty
  partition; there is no cross-scope search mode server-side. The tool now
  always narrows to the current project and says so in its description.

[0.2.1]: https://github.com/xeon826/ever-opencode/releases/tag/v0.2.1

## [0.2.0] - 2026-11-19

### Added

- Agent memory tools via OpenCode V2 `ctx.tool.transform` — the mem0-parity
  gap: `everos_search` (on-demand server-side recall, project scope default,
  `scope: "global"` widening, `top_k` clamp), `everos_add` (store one fact
  now: deferred add + synchronous flush; search indexes may lag a few
  seconds), and `everos_flush` (force extraction of the session's deferred
  capture buffer). Server failures surface as tool-result content, never
  thrown.
- Live integration harness: `npm run test:integration` (gated behind
  `EVEROS_INTEGRATION=1`) — health → add → flush → search round-trip against
  a real EverOS server in a throwaway app scope; skips when the server is
  down. Ten new unit tests cover the tool surface.
- Git-based installs: `dist/` is committed, so the plugin installs straight
  from GitHub with no build step or lifecycle scripts — `opencode plugin add
  github:xeon826/ever-opencode#v0.2.0` — no npm registry required. (bun
  blocks git-dep lifecycle scripts by default, so an install-time build is
  not viable; committing the build output is the standard git-package
  pattern.)

### Changed

- Episode rendering extracted to `formatEpisodeLines` and shared by recall
  injection and the tools (single representation).

[0.2.0]: https://github.com/xeon826/ever-opencode/releases/tag/v0.2.0

## [0.1.0] - 2026-11-03

### Added

- Capture on every completed assistant turn (`session.text.ended`) with
  deferred extraction — buffered server-side, no LLM at capture time,
  fire-and-forget so turn end is never blocked.
- Recall injection via the `context` session hook: relevant episodes pushed
  into system context, deduped per user message.
- Flush policy: flush on the Nth captured turn (`flushEvery`, default 3) and
  always before compaction.
- Provider-neutral server config: the plugin is LLM-free and holds no API
  keys; all provider choice lives in EverOS `[llm]` config (any
  OpenAI-compatible chat-completions endpoint).
- Graceful degradation: server-unreachable sessions latch degraded, log once,
  and retry — the agent loop is never blocked.
- Plugin options (`everosUrl`, `flushEvery`, `topK`, `recallMethod`, `enabled`,
  `logLevel`) with `EVEROS_URL` / `EVEROS_USER_ID` / `EVEROS_APP_ID` env
  overrides.
- Hermetic test suite: unit tests for extraction, identity, client, and
  injection, plus contract tests against a mock EverOS API.

[0.1.0]: https://github.com/xeon826/ever-opencode/releases/tag/v0.1.0
