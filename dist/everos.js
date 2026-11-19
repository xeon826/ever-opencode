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
export class EverosError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = "EverosError";
        this.code = code;
        this.status = status;
    }
}
export class EverosClient {
    baseUrl;
    doFetch;
    constructor(baseUrl, doFetch = fetch) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.doFetch = doFetch;
    }
    async health(timeoutMs = 2000) {
        // Health lives at the server root, no /api/v2 prefix.
        return this.request("GET", "/health", undefined, timeoutMs);
    }
    async addMemory(scope, messages, opts = {}) {
        const body = {
            session_id: scope.session_id,
            app_id: scope.app_id,
            project_id: scope.project_id,
            messages,
            ...(opts.deferExtraction ? { defer_extraction: true } : {}),
        };
        const data = await this.request("POST", "/api/v2/memory/add", body, opts.timeoutMs ?? 5000);
        return { status: data?.data?.status ?? "ok" };
    }
    async flushMemory(scope, 
    // Flush triggers synchronous server-side extraction (an LLM call plus
    // parse + markdown write), so it needs a generous bound. Capture-path
    // callers invoke it fire-and-forget; this only bounds the HTTP wait.
    timeoutMs = 30000) {
        const body = {
            session_id: scope.session_id,
            app_id: scope.app_id,
            project_id: scope.project_id,
        };
        await this.request("POST", "/api/v2/memory/flush", body, timeoutMs);
        return { status: "flushed" };
    }
    async searchMemories(userId, query, opts = {}) {
        const body = {
            user_id: userId,
            query,
            method: opts.method ?? "keyword",
            top_k: opts.topK ?? 5,
        };
        if (opts.scope?.appId)
            body.app_id = opts.scope.appId;
        if (opts.scope?.projectId)
            body.project_id = opts.scope.projectId;
        const data = await this.request("POST", "/api/v2/memory/search", body, opts.timeoutMs ?? 2000);
        // Success envelope: {request_id, data:{episodes:[...]}} — episodes never
        // sit at the top level.
        return Array.isArray(data?.data?.episodes) ? data.data.episodes : [];
    }
    async request(method, path, body, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await this.doFetch(this.baseUrl + path, {
                method,
                headers: body === undefined ? undefined : { "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });
        }
        catch (err) {
            clearTimeout(timer);
            const cause = err instanceof Error ? err : new Error(String(err));
            const aborted = cause.name === "AbortError";
            throw new EverosError(aborted ? "timeout" : "connection_failed", aborted
                ? `EverOS request timed out after ${timeoutMs}ms: ${method} ${path}`
                : `EverOS request failed: ${method} ${path}: ${cause.message}`, aborted ? 408 : 0);
        }
        clearTimeout(timer);
        const text = await res.text();
        let json = undefined;
        try {
            json = text.length > 0 ? JSON.parse(text) : undefined;
        }
        catch {
            // fall through: non-JSON body
        }
        if (!res.ok) {
            // Error envelope: {request_id, error:{code, message}}
            const code = json?.error?.code;
            const message = json?.error?.message;
            if (typeof code === "string" || typeof message === "string") {
                throw new EverosError(typeof code === "string" ? code : "http_error", typeof message === "string" ? message : `HTTP ${res.status}`, res.status);
            }
            throw new EverosError("http_error", `HTTP ${res.status} ${method} ${path}`, res.status);
        }
        return json;
    }
}
