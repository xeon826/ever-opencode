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
import type { PluginContext } from "./types.js";
export declare const storageKeys: {
    offset: (sessionID: string) => string;
    captures: (sessionID: string) => string;
    degraded: (sessionID: string) => string;
    recall: (sessionID: string, userMessageID: string) => string;
};
export declare function setupPlugin(rawCtx: PluginContext): Promise<() => void>;
export type { EverosOptions, PluginContext } from "./types.js";
export type { EverosEpisode, EverosMessage, EverosError } from "./everos.js";
export { EverosClient } from "./everos.js";
export { extractTranscript } from "./extract.js";
export { formatRecall, formatEpisodeLines } from "./inject.js";
export { buildTools, everosToolNames, registerTools } from "./tools.js";
export { slugify, resolveIdentity } from "./identity.js";
declare const _default: {
    id: string;
    setup: (ctx: unknown) => Promise<() => void>;
};
export default _default;
