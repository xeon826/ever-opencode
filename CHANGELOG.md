# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
