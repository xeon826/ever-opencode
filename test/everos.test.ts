import { describe, expect, it } from "vitest";
import { EverosClient, EverosError } from "../src/everos.js";
import type { FetchLike } from "../src/everos.js";

function jsonFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }): FetchLike {
  return async (input, init) => {
    if (capture) {
      capture.url = input;
      capture.init = init;
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("EverosClient", () => {
  it("health GETs /health without /api/v2 prefix", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = new EverosClient("http://127.0.0.1:8000/", jsonFetch(200, { status: "ok", capabilities: { embed: true } }, capture));
    const health = await client.health();
    expect(health.status).toBe("ok");
    expect(health.capabilities?.embed).toBe(true);
    expect(capture.url).toBe("http://127.0.0.1:8000/health");
    expect(capture.init?.method).toBe("GET");
  });

  it("addMemory posts the add payload with defer_extraction", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = new EverosClient("http://x", jsonFetch(200, { data: { status: "accumulated" } }, capture));
    const result = await client.addMemory(
      { session_id: "s1", app_id: "opencode", project_id: "proj" },
      [{ sender_id: "dan", role: "user", timestamp: 123, content: "hi" }],
      { deferExtraction: true },
    );
    expect(result.status).toBe("accumulated");
    expect(capture.url).toBe("http://x/api/v2/memory/add");
    const body = JSON.parse(capture.init!.body as string);
    expect(body).toMatchObject({
      session_id: "s1",
      app_id: "opencode",
      project_id: "proj",
      defer_extraction: true,
    });
    expect(body.messages[0]).toMatchObject({ sender_id: "dan", role: "user", timestamp: 123 });
  });

  it("flushMemory posts to /api/v2/memory/flush", async () => {
    const capture: { url?: string } = {};
    const client = new EverosClient("http://x", jsonFetch(200, {}, capture));
    await client.flushMemory({ session_id: "s1" });
    expect(capture.url).toBe("http://x/api/v2/memory/flush");
  });

  it("searchMemories posts user_id/query/method/top_k and returns episodes", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = new EverosClient("http://x", jsonFetch(200, { episodes: [{ summary: "s", score: 0.5 }] }, capture));
    const episodes = await client.searchMemories("dan", "query text", { method: "keyword", topK: 5 });
    expect(episodes).toHaveLength(1);
    const body = JSON.parse(capture.init!.body as string);
    expect(body).toMatchObject({ user_id: "dan", query: "query text", method: "keyword", top_k: 5 });
  });

  it("unwraps error envelope into EverosError", async () => {
    const client = new EverosClient("http://x", jsonFetch(400, { request_id: "r1", error: { code: "bad_scope", message: "invalid session_id" } }));
    const err = await client.searchMemories("u", "q").catch((e) => e);
    expect(err).toBeInstanceOf(EverosError);
    expect(err.code).toBe("bad_scope");
    expect(err.message).toBe("invalid session_id");
    expect(err.status).toBe(400);
  });

  it("wraps non-JSON HTTP errors without envelope", async () => {
    const client = new EverosClient("http://x", async () => new Response("boom", { status: 500 }));
    const err = await client.health().catch((e) => e);
    expect(err).toBeInstanceOf(EverosError);
    expect(err.code).toBe("http_error");
    expect(err.status).toBe(500);
  });

  it("times out via AbortController (health 2s budget honored)", async () => {
    const client = new EverosClient("http://x", (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const err = await client.health(20).catch((e) => e);
    expect(err).toBeInstanceOf(EverosError);
    expect(err.code).toBe("timeout");
  });

  it("reports connection failures as connection_failed", async () => {
    const client = new EverosClient("http://x", async () => {
      throw new Error("ECONNREFUSED");
    });
    const err = await client.flushMemory({ session_id: "s" }, 10).catch((e) => e);
    expect(err).toBeInstanceOf(EverosError);
    expect(err.code).toBe("connection_failed");
  });
});
