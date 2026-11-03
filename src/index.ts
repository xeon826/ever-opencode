/**
 * everos-opencode — persistent memory plugin for OpenCode V2.
 *
 * Zero agent discipline: capture each turn (fire-and-forget, deferred
 * extraction), flush on the Nth capture and before compaction, and inject
 * recall into future turns via the `context` hook. The plugin is LLM-free:
 * it only talks HTTP to a local EverOS server; extraction runs server-side.
 *
 * Capture trigger (verified against @opencode/plugin 2.2.5 + @opencode/client
 * generated event types): the V2 event stream has NO "message.*" events. The
 * assistant-completion event is `session.text.ended`
 * (data: {sessionID, assistantMessageID, ordinal, text}); we subscribe to it
 * and re-read the full session transcript each time, letting the offset
 * cursor emit only NEW messages. `session.step.ended` / `session.idle` also
 * exist but fire less precisely per completed text.
 */

import { EverosClient, EverosError, type EverosEpisode, type ScopeIds } from "./everos.js";
import { extractTranscript, type TranscriptMessage } from "./extract.js";
import { formatRecall } from "./inject.js";
import { resolveScope } from "./identity.js";
import { Logger, type LogLevel } from "./log.js";
import type { EverosOptions, PluginContext } from "./types.js";

const DEFAULTS: Required<Omit<EverosOptions, "everosUrl">> & { everosUrl?: string } = {
  everosUrl: "http://127.0.0.1:8000",
  flushEvery: 3,
  topK: 5,
  recallMethod: "keyword",
  enabled: true,
  logLevel: "info",
};

function resolveConfig(options: Readonly<Record<string, unknown>>): Required<EverosOptions> {
  // Precedence: explicit option > env > default.
  const url = (options.everosUrl as string | undefined) ?? process.env.EVEROS_URL ?? DEFAULTS.everosUrl!;
  return {
    everosUrl: url,
    flushEvery: clampInt(options.flushEvery, DEFAULTS.flushEvery, 1),
    topK: clampInt(options.topK, DEFAULTS.topK, 1),
    recallMethod: (options.recallMethod as string | undefined) ?? DEFAULTS.recallMethod,
    enabled: (options.enabled as boolean | undefined) ?? DEFAULTS.enabled,
    logLevel: ((options.logLevel as LogLevel | undefined) ?? DEFAULTS.logLevel) as LogLevel,
  };
}

function clampInt(raw: unknown, fallback: number, min: number): number {
  const n = typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

export const storageKeys = {
  offset: (sessionID: string) => `everos:offset:${sessionID}`,
  captures: (sessionID: string) => `everos:captures:${sessionID}`,
  degraded: (sessionID: string) => `everos:degraded:${sessionID}`,
  recall: (sessionID: string, userMessageID: string) => `everos:recall:${sessionID}:${userMessageID}`,
};

export async function setupPlugin(rawCtx: PluginContext): Promise<() => void> {
  const config = resolveConfig(rawCtx.options);
  const log = new Logger(config.logLevel);

  // Core plugin state. `null` when disabled — hooks become no-ops.
  let core: {
    ctx: PluginContext;
    client: EverosClient;
    scopeBase: { appId: string; projectId: string; userId: string };
  } | null = null;

  if (config.enabled) {
    const client = new EverosClient(config.everosUrl);
    const scopeBase = await resolveScope(rawCtx, "");
    core = { ctx: rawCtx, client, scopeBase };
  }

  /** Mark a session degraded (connection refused / timeout), log once. */
  const markDegraded = async (sessionID: string, err: unknown): Promise<void> => {
    const key = storageKeys.degraded(sessionID);
    const already = await rawCtx.storage.get(key);
    if (!already) {
      await rawCtx.storage.set(key, true);
      const detail = err instanceof EverosError ? `${err.code}: ${err.message}` : String(err);
      log.error(`degraded:${sessionID}`, `server unreachable, session degraded (will retry): ${detail}`);
    }
  };

  const withTimeoutGuard = async (fn: () => Promise<void>, sessionID: string): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      await markDegraded(sessionID, err);
    }
  };

  // ---- Recall injection -------------------------------------------------

  const recallRegistration = await rawCtx.session.hook("context", async (input) => {
    try {
      if (!core || !config.enabled) return;
      const sessionID: string = input.sessionID;

      // Dedupe per user message: the context hook fires on every model call,
      // so the same user turn would otherwise trigger a search per call.
      const messages: TranscriptMessage[] = Array.isArray(input.messages) ? input.messages : [];
      const lastUser = [...messages].reverse().find((m) => m.type === "user");
      const userKey = typeof lastUser?.id === "string" ? lastUser.id : `noid:${messages.length}`;
      const dedupeKey = storageKeys.recall(sessionID, userKey);
      if (await rawCtx.storage.get(dedupeKey)) return;
      await rawCtx.storage.set(dedupeKey, true);

      const query = messages
        .filter((m) => m.type === "user")
        .map((m) => (typeof m.text === "string" ? m.text : ""))
        .filter((t) => t.trim().length > 0)
        .slice(-3)
        .join(" ")
        .slice(0, 2000);
      if (query.trim().length === 0) return;

      const degraded = await rawCtx.storage.get(storageKeys.degraded(sessionID));
      if (degraded) return;

      let episodes: EverosEpisode[];
      try {
        episodes = await core.client.searchMemories(core.scopeBase.userId, query, {
          method: config.recallMethod,
          topK: config.topK,
          scope: { appId: core.scopeBase.appId, projectId: core.scopeBase.projectId },
        });
      } catch (err) {
        await markDegraded(sessionID, err);
        return;
      }

      const block = formatRecall(episodes, { topK: config.topK });
      if (block.length === 0) return;

      const system: Array<{ type: string; text: string }> = Array.isArray(input.system) ? input.system : [];
      system.push({ type: "text", text: block });
    } catch (err) {
      // Never let recall break the turn.
      log.debug(`recall error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ---- Capture ----------------------------------------------------------

  const captureOnce = async (sessionID: string): Promise<void> => {
    if (!core) return;
    await withTimeoutGuard(async () => {
      const transcript = (await core!.ctx.session.context({ sessionID })) as TranscriptMessage[];
      const offsetRaw = await rawCtx.storage.get(storageKeys.offset(sessionID));
      const offset = typeof offsetRaw === "number" ? offsetRaw : 0;

      const { messages, offset: nextOffset } = extractTranscript(transcript, offset, {
        senderId: core.scopeBase.userId,
      });
      await rawCtx.storage.set(storageKeys.offset(sessionID), nextOffset);
      if (messages.length === 0) return;

      const scope: ScopeIds = {
        session_id: sessionID.slice(0, 128),
        app_id: core.scopeBase.appId,
        project_id: core.scopeBase.projectId,
      };
      // Deferred extraction: buffered server-side, no LLM at capture time.
      await core.client.addMemory(scope, messages, { deferExtraction: true });

      const capturesRaw = await rawCtx.storage.get(storageKeys.captures(sessionID));
      const captures = (typeof capturesRaw === "number" ? capturesRaw : 0) + 1;
      await rawCtx.storage.set(storageKeys.captures(sessionID), captures);

      if (captures % config.flushEvery === 0) {
        await core.client.flushMemory(scope);
        log.debug(`flushed after ${captures} captures (${sessionID})`);
      }
    }, sessionID);
  };

  // Serialize captures per session: events can arrive while a previous
  // capture is still in flight, and concurrent reads of the offset cursor
  // would double-capture the same messages.
  const captureQueues = new Map<string, Promise<void>>();

  // Fire-and-forget: the event subscription handler must never block turn end.
  const enqueueCapture = (sessionID: string): void => {
    const prev = captureQueues.get(sessionID) ?? Promise.resolve();
    const next = prev
      .then(() => captureOnce(sessionID))
      .catch(() => {
        /* degraded latch handles reporting */
      });
    captureQueues.set(sessionID, next);
  };

  const controller = new AbortController();
  const consumeEvents = async (): Promise<void> => {
    try {
      const stream = rawCtx.event.subscribe({
        types: ["session.text.ended"],
        signal: controller.signal,
      });
      for await (const ev of stream) {
        if (controller.signal.aborted) break;
        const sessionID = ev?.data?.sessionID;
        if (typeof sessionID !== "string" || sessionID.length === 0) continue;
        enqueueCapture(sessionID);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        log.debug(`event subscription error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  void consumeEvents();

  // ---- Flush before compaction -----------------------------------------

  const compactionRegistration = await rawCtx.session.hook("compaction", async (input) => {
    if (!core) return;
    const sessionID: string = input.sessionID;
    await withTimeoutGuard(async () => {
      const scope: ScopeIds = {
        session_id: sessionID.slice(0, 128),
        app_id: core!.scopeBase.appId,
        project_id: core!.scopeBase.projectId,
      };
      await core!.client.flushMemory(scope);
      log.debug(`flushed before compaction (${sessionID})`);
    }, sessionID);
  });

  // ---- Cleanup ----------------------------------------------------------

  return () => {
    controller.abort();
    void recallRegistration.dispose();
    void compactionRegistration.dispose();
  };
}

// ---- Plugin entry point -------------------------------------------------
// Registered in OpenCode config as:
//   "plugins": ["everos-opencode"]
//   or { "package": "everos-opencode", "options": { ... } }

export type { EverosOptions, PluginContext } from "./types.js";
export type { EverosEpisode, EverosMessage, EverosError } from "./everos.js";
export { EverosClient } from "./everos.js";
export { extractTranscript } from "./extract.js";
export { formatRecall } from "./inject.js";
export { slugify, resolveIdentity } from "./identity.js";

export default {
  // Matches the V2 plugin object contract ({ id, setup }); kept structural so
  // this module imports cleanly without the heavy SDK runtime in tests.
  id: "everos-opencode",
  setup: (ctx: unknown) => setupPlugin(ctx as PluginContext),
};
