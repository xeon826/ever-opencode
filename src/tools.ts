/**
 * Agent-facing memory tools (OpenCode V2 `ctx.tool.transform`).
 *
 * The passive path (capture + recall injection) is automatic; these tools give
 * the agent an explicit query/write surface — mirroring the mem0 plugin's
 * tool-based memory access:
 *   everos_search — query memories on demand (BM25/vector recall server-side)
 *   everos_add    — store a fact now (add + synchronous extraction via flush)
 *   everos_flush  — force extraction of the session's deferred capture buffer
 *
 * Tool definitions are plain structural objects: `input` is a JSON Schema and
 * `execute` returns `{content}` — no SDK runtime import, keeping the plugin
 * unit-testable with synthetic contexts.
 */

import type { EverosClient, EverosError, EverosEpisode, ScopeIds } from "./everos.js";
import { formatEpisodeLines } from "./inject.js";
import type { Logger } from "./log.js";

/** JSON-Schema-backed tool definition (structural subset of V2 Tool.Info). */
export interface EverosToolDef {
  readonly name: string;
  readonly description: string;
  readonly input: Record<string, unknown>;
  execute(input: unknown, context: { sessionID?: string }): Promise<ToolOutput>;
}

/** Structural `Tool.Result`: the model sees `content`. */
export interface ToolOutput {
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ToolEditorLike {
  add(tool: EverosToolDef): void;
}

export interface ToolDomainLike {
  transform(callback: (editor: ToolEditorLike) => void): Promise<{ dispose(): Promise<void> | void }>;
}

export interface ToolDeps {
  readonly client: EverosClient;
  /** Identity resolved at setup: stable user/app/project scope base. */
  readonly scopeBase: { userId: string; appId: string; projectId: string };
  readonly recallMethod: string;
  readonly defaultTopK: number;
  readonly log: Logger;
}

const TOOL_NAMES = ["everos_search", "everos_add", "everos_flush"] as const;

function clampTopK(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(25, Math.max(1, Math.floor(n)));
}

/** Capture-path scope ids are derived per session; tools do the same. */
function sessionScope(deps: ToolDeps, sessionID: string | undefined): ScopeIds {
  return {
    session_id: (sessionID ?? "everos-tools").slice(0, 128),
    app_id: deps.scopeBase.appId,
    project_id: deps.scopeBase.projectId,
  };
}

/** Never let a tool failure crash the model turn — report it as content. */
async function guarded(deps: ToolDeps, tool: string, fn: () => Promise<ToolOutput>): Promise<ToolOutput> {
  try {
    return await fn();
  } catch (err) {
    const detail =
      err instanceof Error && (err as EverosError).code
        ? `${(err as EverosError).code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    deps.log.debug(`${tool} error: ${detail}`);
    return { content: `everos ${tool} failed: ${detail}`, metadata: { error: true } };
  }
}

function makeSearchTool(deps: ToolDeps): EverosToolDef {
  return {
    name: "everos_search",
    description:
      "Search this project's persistent EverOS memory (episodes + atomic facts from previous " +
      "sessions of this project). Use proactively when context from past work would help — " +
      "prior decisions, preferences, debugging history. Results are ranked server-side " +
      "(BM25/vector); each line carries a relevance score and age. Searches the current " +
      "project's scope only — EverOS cannot search across projects.",
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query, e.g. 'how did we fix the flaky login test'" },
        top_k: { type: "number", description: `Max results (1-25, default ${deps.defaultTopK})` },
      },
      required: ["query"],
    },
    async execute(rawInput, context) {
      const input = (rawInput ?? {}) as { query?: unknown; top_k?: unknown };
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (query.length === 0) {
        return { content: "everos_search failed: 'query' (non-empty string) is required." };
      }
      return guarded(deps, "everos_search", async () => {
        const topK = clampTopK(input.top_k, deps.defaultTopK);
        // Scope narrowing is mandatory: the server pins app_id/project_id (defaults
        // "default"/"default") into the store filter, so omitting either searches an
        // empty partition — there is no cross-scope mode in the v2 API.
        const episodes = await deps.client.searchMemories(deps.scopeBase.userId, query, {
          method: deps.recallMethod,
          topK,
          scope: { appId: deps.scopeBase.appId, projectId: deps.scopeBase.projectId },
        });
        const lines = formatEpisodeLines(episodes, { topK });
        if (lines.length === 0) {
          return { content: `No memories found for: ${query}` };
        }
        return {
          content: [`EverOS memories (${lines.length}, may be imperfect):`, ...lines].join("\n"),
          metadata: { sessionID: context.sessionID, scope: "project", count: lines.length },
        };
      });
    },
  };
}

function makeAddTool(deps: ToolDeps): EverosToolDef {
  return {
    name: "everos_add",
    description:
      "Store a durable fact in EverOS memory (decisions, preferences, learnings) so future " +
      "sessions can recall it. One sentence per call. The fact is extracted synchronously " +
      "but may take a few seconds before search indexes see it.",
    input: {
      type: "object",
      properties: {
        text: { type: "string", description: "The fact to remember, one sentence" },
      },
      required: ["text"],
    },
    async execute(rawInput, context) {
      const input = (rawInput ?? {}) as { text?: unknown };
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (text.length === 0) {
        return { content: "everos_add failed: 'text' (non-empty string) is required." };
      }
      return guarded(deps, "everos_add", async () => {
        const scope = sessionScope(deps, context?.sessionID);
        await deps.client.addMemory(
          scope,
          [{ sender_id: deps.scopeBase.userId, role: "user", timestamp: Date.now(), content: text }],
          { deferExtraction: true },
        );
        // Synchronous extraction so the new fact is queryable right away.
        await deps.client.flushMemory(scope);
        return {
          content: `Remembered: ${text} (may take a few seconds to become searchable)`,
          metadata: { sessionID: scope.session_id },
        };
      });
    },
  };
}

function makeFlushTool(deps: ToolDeps): EverosToolDef {
  return {
    name: "everos_flush",
    description:
      "Force EverOS to extract memories from this session's captured conversation so far. " +
      "Useful right before asking a question about the current session's history.",
    input: { type: "object", properties: {} },
    async execute(_input, context) {
      return guarded(deps, "everos_flush", async () => {
        const scope = sessionScope(deps, context?.sessionID);
        await deps.client.flushMemory(scope);
        return { content: "EverOS buffer flushed (extraction complete).", metadata: { sessionID: scope.session_id } };
      });
    },
  };
}

/** All tool names this plugin registers (exported for tests/diagnostics). */
export const everosToolNames: readonly string[] = TOOL_NAMES;

/** Build the tool definitions (exported for tests). */
export function buildTools(deps: ToolDeps): EverosToolDef[] {
  return [makeSearchTool(deps), makeAddTool(deps), makeFlushTool(deps)];
}

/**
 * Register the tools via `ctx.tool.transform`. Returns the registration, or
 * `undefined` when the host exposes no tool domain (older hosts / tests).
 */
export async function registerTools(
  ctx: { tool?: ToolDomainLike },
  deps: ToolDeps,
): Promise<{ dispose(): Promise<void> | void } | undefined> {
  if (!ctx.tool) return undefined;
  return ctx.tool.transform((editor) => {
    for (const tool of buildTools(deps)) editor.add(tool);
  });
}
