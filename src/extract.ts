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
  time?: { created?: number };
  text?: string;
  content?: Array<{ type: string; text?: string }>;
}

export interface ExtractResult {
  messages: EverosMessage[];
  /** Updated cursor: number of transcript entries consumed. */
  offset: number;
}

function joinedText(msg: TranscriptMessage): string {
  if (msg.type === "user") {
    return typeof msg.text === "string" ? msg.text : "";
  }
  // assistant: join text parts only
  const parts = Array.isArray(msg.content) ? msg.content : [];
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

export function extractTranscript(
  transcript: TranscriptMessage[],
  offset: number,
  opts: { senderId?: string } = {},
): ExtractResult {
  // Defensive: sort by creation time (append order is normally already stable).
  const sorted = [...transcript].sort(
    (a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0),
  );

  const start = Math.max(0, Math.floor(offset));
  const fresh = start >= sorted.length ? [] : sorted.slice(start);
  const messages: EverosMessage[] = [];

  for (const msg of fresh) {
    if (msg.type !== "user" && msg.type !== "assistant") continue;
    const content = joinedText(msg).trim();
    if (content.length === 0) continue;
    messages.push({
      sender_id: msg.type === "user" ? (opts.senderId ?? "user") : "assistant",
      role: msg.type === "user" ? "user" : "assistant",
      // OpenCode stores message times as epoch milliseconds.
      timestamp: msg.time?.created ?? Date.now(),
      content,
    });
  }

  return { messages, offset: sorted.length };
}
