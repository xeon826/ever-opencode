/**
 * Transcript extraction: OpenCode session messages → EverOS messages.
 *
 * The transcript from `ctx.session.context({sessionID})` is a list of
 * OpenCode `SessionMessageInfo` discriminated by `type`. We keep:
 *   - type "user": has a flat `text` field
 *   - type "assistant": `content` is a tagged-union list; keep `type:"text"`
 *     parts (skip reasoning/tool parts), joined with "\n"
 * and skip everything else (system, synthetic, compaction, shell, skill, …).
 *
 * Offset tracking: the caller passes in the number of transcript entries
 * already consumed (cursor), we return only NEW messages plus the updated
 * cursor. The transcript is append-ordered by creation time, so the index
 * cursor is stable. The cursor is passed in/out and never stored here.
 */
import type { EverosMessage } from "./everos.js";
/** Internal view of an OpenCode session message (subset). */
export interface TranscriptMessage {
    id?: string;
    type: string;
    time?: {
        created?: number;
    };
    text?: string;
    content?: Array<{
        type: string;
        text?: string;
    }>;
}
export interface ExtractResult {
    messages: EverosMessage[];
    /** Updated cursor: number of transcript entries consumed. */
    offset: number;
}
export declare function extractTranscript(transcript: TranscriptMessage[], offset: number, opts?: {
    senderId?: string;
}): ExtractResult;
