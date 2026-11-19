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
import type { EverosClient } from "./everos.js";
import type { Logger } from "./log.js";
/** JSON-Schema-backed tool definition (structural subset of V2 Tool.Info). */
export interface EverosToolDef {
    readonly name: string;
    readonly description: string;
    readonly input: Record<string, unknown>;
    execute(input: unknown, context: {
        sessionID?: string;
    }): Promise<ToolOutput>;
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
    transform(callback: (editor: ToolEditorLike) => void): Promise<{
        dispose(): Promise<void> | void;
    }>;
}
export interface ToolDeps {
    readonly client: EverosClient;
    /** Identity resolved at setup: stable user/app/project scope base. */
    readonly scopeBase: {
        userId: string;
        appId: string;
        projectId: string;
    };
    readonly recallMethod: string;
    readonly defaultTopK: number;
    readonly log: Logger;
}
/** All tool names this plugin registers (exported for tests/diagnostics). */
export declare const everosToolNames: readonly string[];
/** Build the tool definitions (exported for tests). */
export declare function buildTools(deps: ToolDeps): EverosToolDef[];
/**
 * Register the tools via `ctx.tool.transform`. Returns the registration, or
 * `undefined` when the host exposes no tool domain (older hosts / tests).
 */
export declare function registerTools(ctx: {
    tool?: ToolDomainLike;
}, deps: ToolDeps): Promise<{
    dispose(): Promise<void> | void;
} | undefined>;
