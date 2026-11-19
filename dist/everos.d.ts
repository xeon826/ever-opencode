/**
 * HTTP client for a local EverOS server.
 *
 * The plugin is LLM-free: it is only an HTTP client. All provider choice
 * lives in the EverOS server config (~/.everos/everos.toml, [llm] section) —
 * the plugin never sees a model API key.
 *
 * API surface (EverOS v2):
 *   GET  /health                       (no /api/v2 prefix)
 *   POST /api/v2/memory/add            {session_id, app_id?, project_id?, messages[], defer_extraction?}
 *   POST /api/v2/memory/flush          {session_id, app_id?, project_id?}
 *   POST /api/v2/memory/search         {user_id, query, method, top_k}
 *
 * Errors arrive as {request_id, error:{code, message}} and are unwrapped
 * into EverosError. All requests are bounded by an AbortController timeout.
 */
export interface EverosMessage {
    sender_id: string;
    role: "user" | "assistant" | "tool";
    /** Epoch milliseconds. */
    timestamp: number;
    content: string;
}
export interface ScopeIds {
    session_id: string;
    app_id?: string;
    project_id?: string;
}
export interface EverosEpisode {
    summary: string;
    score: number;
    atomic_facts?: string[];
    timestamp?: number;
}
export interface HealthInfo {
    status: string;
    capabilities?: {
        embed?: boolean;
    };
}
export declare class EverosError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status: number);
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export declare class EverosClient {
    readonly baseUrl: string;
    private readonly doFetch;
    constructor(baseUrl: string, doFetch?: FetchLike);
    health(timeoutMs?: number): Promise<HealthInfo>;
    addMemory(scope: ScopeIds, messages: EverosMessage[], opts?: {
        deferExtraction?: boolean;
        timeoutMs?: number;
    }): Promise<{
        status: string;
    }>;
    flushMemory(scope: ScopeIds, timeoutMs?: number): Promise<{
        status: string;
    }>;
    searchMemories(userId: string, query: string, opts?: {
        method?: string;
        topK?: number;
        timeoutMs?: number;
        /** Scope narrowing — results never cross scopes (server default is "default"). */
        scope?: {
            appId?: string;
            projectId?: string;
        };
    }): Promise<EverosEpisode[]>;
    private request;
}
