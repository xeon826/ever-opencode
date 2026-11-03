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
  capabilities?: { embed?: boolean };
}

export class EverosError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "EverosError";
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class EverosClient {
  readonly baseUrl: string;
  private readonly doFetch: FetchLike;

  constructor(baseUrl: string, doFetch: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.doFetch = doFetch;
  }

  async health(timeoutMs = 2000): Promise<HealthInfo> {
    // Health lives at the server root, no /api/v2 prefix.
    return this.request<HealthInfo>("GET", "/health", undefined, timeoutMs);
  }

  async addMemory(
    scope: ScopeIds,
    messages: EverosMessage[],
    opts: { deferExtraction?: boolean; timeoutMs?: number } = {},
  ): Promise<{ status: string }> {
    const body = {
      session_id: scope.session_id,
      app_id: scope.app_id,
      project_id: scope.project_id,
      messages,
      ...(opts.deferExtraction ? { defer_extraction: true } : {}),
    };
    const data = await this.request<{ data?: { status?: string } }>(
      "POST",
      "/api/v2/memory/add",
      body,
      opts.timeoutMs ?? 5000,
    );
    return { status: data?.data?.status ?? "ok" };
  }

  async flushMemory(
    scope: ScopeIds,
    // Flush triggers synchronous server-side extraction (an LLM call plus
    // parse + markdown write), so it needs a generous bound. Capture-path
    // callers invoke it fire-and-forget; this only bounds the HTTP wait.
    timeoutMs = 30000,
  ): Promise<{ status: string }> {
    const body = {
      session_id: scope.session_id,
      app_id: scope.app_id,
      project_id: scope.project_id,
    };
    await this.request<unknown>(
      "POST",
      "/api/v2/memory/flush",
      body,
      timeoutMs,
    );
    return { status: "flushed" };
  }

  async searchMemories(
    userId: string,
    query: string,
    opts: {
      method?: string;
      topK?: number;
      timeoutMs?: number;
      /** Scope narrowing — results never cross scopes (server default is "default"). */
      scope?: { appId?: string; projectId?: string };
    } = {},
  ): Promise<EverosEpisode[]> {
    const body: Record<string, unknown> = {
      user_id: userId,
      query,
      method: opts.method ?? "keyword",
      top_k: opts.topK ?? 5,
    };
    if (opts.scope?.appId) body.app_id = opts.scope.appId;
    if (opts.scope?.projectId) body.project_id = opts.scope.projectId;
    const data = await this.request<{ data?: { episodes?: EverosEpisode[] } }>(
      "POST",
      "/api/v2/memory/search",
      body,
      opts.timeoutMs ?? 2000,
    );
    // Success envelope: {request_id, data:{episodes:[...]}} — episodes never
    // sit at the top level.
    return Array.isArray(data?.data?.episodes) ? data.data!.episodes : [];
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.doFetch(this.baseUrl + path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const cause = err instanceof Error ? err : new Error(String(err));
      const aborted = cause.name === "AbortError";
      throw new EverosError(
        aborted ? "timeout" : "connection_failed",
        aborted
          ? `EverOS request timed out after ${timeoutMs}ms: ${method} ${path}`
          : `EverOS request failed: ${method} ${path}: ${cause.message}`,
        aborted ? 408 : 0,
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    let json: any = undefined;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      // fall through: non-JSON body
    }

    if (!res.ok) {
      // Error envelope: {request_id, error:{code, message}}
      const code = json?.error?.code;
      const message = json?.error?.message;
      if (typeof code === "string" || typeof message === "string") {
        throw new EverosError(
          typeof code === "string" ? code : "http_error",
          typeof message === "string" ? message : `HTTP ${res.status}`,
          res.status,
        );
      }
      throw new EverosError("http_error", `HTTP ${res.status} ${method} ${path}`, res.status);
    }
    return json as T;
  }
}
