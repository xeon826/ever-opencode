import { describe, expect, it } from "vitest";
import { extractTranscript, type TranscriptMessage } from "../src/extract.js";

function user(text: string, created: number, id = `u${created}`): TranscriptMessage {
  return { id, type: "user", time: { created }, text };
}

function assistant(parts: Array<{ type: string; text?: string }>, created: number, id = `a${created}`): TranscriptMessage {
  return { id, type: "assistant", time: { created }, content: parts };
}

describe("extractTranscript", () => {
  const transcript: TranscriptMessage[] = [
    user("hello", 1),
    assistant([{ type: "text", text: "hi there" }], 2),
    { type: "synthetic", time: { created: 3 }, text: "compaction notice" },
    { type: "system", time: { created: 4 }, text: "system prompt" },
    assistant([{ type: "reasoning", text: "thinking..." }, { type: "text", text: "answer part 1" }, { type: "text", text: "part 2" }], 5),
    assistant([{ type: "tool", text: "tool call" }], 6),
    user("second question", 7),
  ];

  it("extracts only user/assistant text messages", () => {
    const { messages } = extractTranscript(transcript, 0, { senderId: "dan" });
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant", "user"]);
  });

  it("skips empty content after filtering", () => {
    const only: TranscriptMessage[] = [assistant([{ type: "tool" }], 1)];
    const { messages, offset } = extractTranscript(only, 0);
    expect(messages).toHaveLength(0);
    expect(offset).toBe(1);
  });

  it("joins multi-part assistant text with newline", () => {
    const { messages } = extractTranscript(transcript, 0);
    expect(messages[2].content).toBe("answer part 1\npart 2");
  });

  it("offset tracking returns only NEW messages", () => {
    const first = extractTranscript(transcript, 0);
    expect(first.messages).toHaveLength(4);
    expect(first.offset).toBe(7);

    const second = extractTranscript(transcript, first.offset);
    expect(second.messages).toHaveLength(0);

    const grown = [...transcript, user("third", 8)];
    const third = extractTranscript(grown, first.offset);
    expect(third.messages).toHaveLength(1);
    expect(third.messages[0].content).toBe("third");
    expect(third.offset).toBe(8);
  });

  it("preserves epoch-ms timestamps", () => {
    const { messages } = extractTranscript(transcript, 0);
    expect(messages[0].timestamp).toBe(1);
    expect(messages[1].timestamp).toBe(2);
  });

  it("uses senderId for user messages", () => {
    const { messages } = extractTranscript(transcript, 0, { senderId: "alice" });
    expect(messages[0].sender_id).toBe("alice");
    expect(messages[1].sender_id).toBe("assistant");
  });

  it("sorts defensively by creation time", () => {
    const shuffled = [transcript[6], transcript[0], transcript[1]];
    const { messages, offset } = extractTranscript(shuffled, 0);
    expect(messages.map((m) => m.timestamp)).toEqual([1, 2, 7]);
    expect(offset).toBe(3);
  });
});
