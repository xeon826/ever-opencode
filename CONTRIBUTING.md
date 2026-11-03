# Contributing

## Setup

```sh
npm install
npm run build    # tsc → dist/ (ESM, NodeNext; imports need .js extensions)
npm test         # vitest unit + contract tests (hermetic, no network)
```

## Conventions

- **Conventional Commits** — `feat:` / `fix:` / `test:` / `ci:` / `docs:` /
  `chore:`. Imperative subjects, ≤72 chars, one logical unit per commit.
- Docs are updated in the same commit as the change they describe.
- Semver; tag releases and add a CHANGELOG entry per release.

## Scope

The plugin is **LLM-free**: it is only an HTTP client to the EverOS server. It
never loads an SDK, never sees an API key, and makes zero model calls. Don't
add provider logic, key handling, or hardcoded endpoints/keys/paths — provider
choice belongs in EverOS `[llm]` config. Pure ESM, global `fetch`, no
platform-only APIs.

## Pull requests

- Keep PRs focused; one concern per PR.
- Tests must pass (`npm run build && npm test`) and new behavior needs tests —
  unit tests for pure functions, contract tests against the mock EverOS API
  for hook handlers.
- CI stays key-free: no test may require network access or real credentials.
