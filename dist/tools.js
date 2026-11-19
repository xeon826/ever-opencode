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
import { formatEpisodeLines } from "./inject.js";
const TOOL_NAMES = ["everos_search", "everos_add", "everos_flush"];
function clampTopK(raw, fallback) {
    const n = typeof raw === "number" ? raw : Number.NaN;
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(25, Math.max(1, Math.floor(n)));
}
/** Capture-path scope ids are derived per session; tools do the same. */
function sessionScope(deps, sessionID) {
    return {
        session_id: (sessionID ?? "everos-tools").slice(0, 128),
        app_id: deps.scopeBase.appId,
        project_id: deps.scopeBase.projectId,
    };
}
/** Never let a tool failure crash the model turn — report it as content. */
async function guarded(deps, tool, fn) {
    try {
        return await fn();
    }
    catch (err) {
        const detail = err instanceof Error && err.code
            ? `${err.code}: ${err.message}`
            : err instanceof Error
                ? err.message
                : String(err);
        deps.log.debug(`${tool} error: ${detail}`);
        return { content: `everos ${tool} failed: ${detail}`, metadata: { error: true } };
    }
}
function makeSearchTool(deps) {
    return {
        name: "everos_search",
        description: "Search the user's persistent EverOS memory (episodes + atomic facts from previous " +
            "sessions). Use proactively when context from past work would help — prior decisions, " +
            "preferences, debugging history. Results are ranked server-side (BM25/vector); each " +
            "line carries a relevance score and age.",
        input: {
            type: "object",
            properties: {
                query: { type: "string", description: "Free-text query, e.g. 'how did we fix the flaky login test'" },
                top_k: { type: "number", description: `Max results (1-25, default ${deps.defaultTopK})` },
                scope: {
                    type: "string",
                    enum: ["project", "global"],
                    description: '"project" (memories from this project only, default) or "global" (all projects)',
                },
            },
            required: ["query"],
        },
        async execute(rawInput, context) {
            const input = (rawInput ?? {});
            const query = typeof input.query === "string" ? input.query.trim() : "";
            if (query.length === 0) {
                return { content: "everos_search failed: 'query' (non-empty string) is required." };
            }
            const global = input.scope === "global";
            return guarded(deps, "everos_search", async () => {
                const episodes = await deps.client.searchMemories(deps.scopeBase.userId, query, {
                    method: deps.recallMethod,
                    topK: clampTopK(input.top_k, deps.defaultTopK),
                    scope: global ? undefined : { appId: deps.scopeBase.appId, projectId: deps.scopeBase.projectId },
                });
                const lines = formatEpisodeLines(episodes, { topK: clampTopK(input.top_k, deps.defaultTopK) });
                if (lines.length === 0) {
                    return { content: `No memories found for: ${query}` };
                }
                return {
                    content: [`EverOS memories (${lines.length}, may be imperfect):`, ...lines].join("\n"),
                    metadata: { sessionID: context.sessionID, scope: global ? "global" : "project", count: lines.length },
                };
            });
        },
    };
}
function makeAddTool(deps) {
    return {
        name: "everos_add",
        description: "Store a durable fact in EverOS memory (decisions, preferences, learnings) so future " +
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
            const input = (rawInput ?? {});
            const text = typeof input.text === "string" ? input.text.trim() : "";
            if (text.length === 0) {
                return { content: "everos_add failed: 'text' (non-empty string) is required." };
            }
            return guarded(deps, "everos_add", async () => {
                const scope = sessionScope(deps, context?.sessionID);
                await deps.client.addMemory(scope, [{ sender_id: deps.scopeBase.userId, role: "user", timestamp: Date.now(), content: text }], { deferExtraction: true });
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
function makeFlushTool(deps) {
    return {
        name: "everos_flush",
        description: "Force EverOS to extract memories from this session's captured conversation so far. " +
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
export const everosToolNames = TOOL_NAMES;
/** Build the tool definitions (exported for tests). */
export function buildTools(deps) {
    return [makeSearchTool(deps), makeAddTool(deps), makeFlushTool(deps)];
}
/**
 * Register the tools via `ctx.tool.transform`. Returns the registration, or
 * `undefined` when the host exposes no tool domain (older hosts / tests).
 */
export async function registerTools(ctx, deps) {
    if (!ctx.tool)
        return undefined;
    return ctx.tool.transform((editor) => {
        for (const tool of buildTools(deps))
            editor.add(tool);
    });
}
