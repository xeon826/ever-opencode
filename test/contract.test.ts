import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { setupPlugin, storageKeys } from "../src/index.js";
import type { PluginContext, TranscriptEvent } from "./helpers.js";
import { makeSyntheticCtx } from "./helpers.js";

// ---- Fixture EverOS server (hermetic, node:http) -----------------------

interface Fixture {
  server: Server;
  url: string;
  counts: { health: number; add: number; flush: number; search: number };
  addDelayMs: number;
  refuseSearch: boolean;
  lastBodies: { add?: any; flush?: any; search?: any };
}

async function startFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    server: createServer(() => {}),
    url: "",
    counts: { health: 0, add: 0, flush: 0, search: 0 },
    addDelayMs: 0,
    refuseSearch: false,
    lastBodies: {},
  };

  fixture.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const readBody = new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    void readBody.then(async (raw) => {
      const body = raw.length > 0 ? JSON.parse(raw) : {};
      const reply = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (req.url === "/health" && req.method === "GET") {
        fixture.counts.health++;
        reply(200, { status: "ok", capabilities: { embed: false } });
        return;
      }
      if (req.url === "/api/v2/memory/add") {
        fixture.lastBodies.add = body;
        fixture.counts.add++;
        if (fixture.addDelayMs > 0) await new Promise((r) => setTimeout(r, fixture.addDelayMs));
        reply(200, { data: { status: "accumulated" } });
        return;
      }
      if (req.url === "/api/v2/memory/flush") {
        fixture.lastBodies.flush = body;
        fixture.counts.flush++;
        reply(200, { data: { status: "flushed" } });
        return;
      }
      if (req.url === "/api/v2/memory/search") {
        fixture.lastBodies.search = body;
        if (fixture.refuseSearch) {
          reply(503, { request_id: "r1", error: { code: "service_unavailable", message: "not ready" } });
          return;
        }
        fixture.counts.search++;
        reply(200, {
          episodes: [{ summary: "likes terse replies", score: 0.8, atomic_facts: [], timestamp: Date.now() - 3600_000 }],
        });
        return;
      }
      reply(404, { request_id: "rx", error: { code: "not_found", message: "unknown route" } });
    });
  });

  await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
  fixture.url = `http://127.0.0.1:${(fixture.server.address() as AddressInfo).port}`;
  return fixture;
}

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---- Transcript helpers ------------------------------------------------

function userMsg(id: string, text: string, created: number) {
  return { id, type: "user", time: { created }, text };
}

function assistantMsg(id: string, text: string, created: number) {
  return { id, type: "assistant", time: { created }, content: [{ type: "text", text }] };
}

// ---- Tests -------------------------------------------------------------

const savedEnv = { EVEROS_USER_ID: process.env.EVEROS_USER_ID, EVEROS_APP_ID: process.env.EVEROS_APP_ID };

afterEach(() => {
  if (savedEnv.EVEROS_USER_ID === undefined) delete process.env.EVEROS_USER_ID;
  else process.env.EVEROS_USER_ID = savedEnv.EVEROS_USER_ID;
  if (savedEnv.EVEROS_APP_ID === undefined) delete process.env.EVEROS_APP_ID;
  else process.env.EVEROS_APP_ID = savedEnv.EVEROS_APP_ID;
});

describe("plugin contract (synthetic ctx + fixture EverOS server)", () => {
  it("flushes on the Nth capture", async () => {
    const fx = await startFixture();
    const ctx: PluginContext = makeSyntheticCtx({ everosUrl: fx.url });
    const transcript = [userMsg("u1", "hello", 1)];
    (ctx.session as any).contextImpl = async () => [...transcript];

    const cleanup = await setupPlugin(ctx as never);

    // One capture per turn: wait for each turn's add to complete before the
    // next emit, mirroring real turn pacing.
    for (let turn = 1; turn <= 3; turn++) {
      transcript.push(assistantMsg(`a${turn}`, `answer ${turn}`, turn * 10));
      (ctx.session as any).emit({ type: "session.text.ended", data: { sessionID: "sess-1" } });
      await waitFor(() => fx.counts.add >= turn);
    }
    await waitFor(() => fx.counts.flush === 1);

    expect(fx.lastBodies.add.defer_extraction).toBe(true);
    expect(fx.lastBodies.flush).toMatchObject({ session_id: "sess-1", app_id: "opencode" });
    cleanup();
    fx.server.close();
  });

  it("recall dedupes per user message and injects one block", async () => {
    const fx = await startFixture();
    const ctx = makeSyntheticCtx({ everosUrl: fx.url });
    const cleanup = await setupPlugin(ctx as never);

    const recallInput = {
      sessionID: "sess-dedupe",
      messages: [userMsg("u1", "how do tests run here?", 1)],
      system: [] as Array<{ type: string; text: string }>,
    };
    // Context hook fires on every model call in a turn — twice here.
    await (ctx.session as any).hooks.context(recallInput);
    await (ctx.session as any).hooks.context(recallInput);

    expect(fx.counts.search).toBe(1);
    expect(recallInput.system).toHaveLength(1);
    expect(recallInput.system[0].text).toContain("<everos-recall>");
    expect(recallInput.system[0].text).toContain("likes terse replies");

    // A new user message may recall again.
    const newInput = { sessionID: "sess-dedupe", messages: [userMsg("u2", "second question", 2)], system: [] as Array<{ type: string; text: string }> };
    await (ctx.session as any).hooks.context(newInput);
    expect(fx.counts.search).toBe(2);

    cleanup();
    fx.server.close();
  });

  it("degraded latch: connection refused marks session and skips further work", async () => {
    // Port 1 on loopback: nothing listens, immediate refusal.
    const ctx = makeSyntheticCtx({ everosUrl: "http://127.0.0.1:1", logLevel: "silent" });
    const cleanup = await setupPlugin(ctx as never);

    const input = { sessionID: "sess-dead", messages: [userMsg("u1", "anyone there?", 1)], system: [] as Array<{ type: string; text: string }> };
    await (ctx.session as any).hooks.context(input);
    expect(await ctx.storage.get(storageKeys.degraded("sess-dead"))).toBe(true);
    expect(input.system).toHaveLength(0);

    // Second recall short-circuits via latch (no way to observe network here,
    // but it must not throw or inject).
    await (ctx.session as any).hooks.context(input);
    expect(input.system).toHaveLength(0);

    // Capture path also latches instead of throwing.
    (ctx.session as any).emit({ type: "session.text.ended", data: { sessionID: "sess-dead" } });
    await new Promise((r) => setTimeout(r, 150));
    expect(await ctx.storage.get(storageKeys.degraded("sess-dead"))).toBe(true);
    cleanup();
  });

  it("search error envelope latches degraded", async () => {
    const fx = await startFixture();
    fx.refuseSearch = true;
    const ctx = makeSyntheticCtx({ everosUrl: fx.url, logLevel: "silent" });
    const cleanup = await setupPlugin(ctx as never);

    const input = { sessionID: "sess-env", messages: [userMsg("u1", "q", 1)], system: [] as Array<{ type: string; text: string }> };
    await (ctx.session as any).hooks.context(input);

    expect(await ctx.storage.get(storageKeys.degraded("sess-env"))).toBe(true);
    expect(input.system).toHaveLength(0);
    // Search was attempted (refused with the error envelope) but not counted.
    expect(fx.lastBodies.search).toMatchObject({ user_id: expect.any(String), query: "q" });
    expect(fx.counts.search).toBe(0);
    cleanup();
    fx.server.close();
  });

  it("capture is fire-and-forget: events never block the loop", async () => {
    const fx = await startFixture();
    fx.addDelayMs = 150;
    const ctx = makeSyntheticCtx({ everosUrl: fx.url });
    const transcript = [userMsg("u1", "one", 1), assistantMsg("a1", "two", 2)];
    (ctx.session as any).contextImpl = async () => [...transcript];

    const cleanup = await setupPlugin(ctx as never);

    // Synchronous emit must return before any capture completes.
    (ctx.session as any).emit({ type: "session.text.ended", data: { sessionID: "sess-async" } });
    (ctx.session as any).emit({ type: "session.text.ended", data: { sessionID: "sess-async" } });
    expect(fx.counts.add).toBe(0); // nothing has completed yet

    await waitFor(() => fx.counts.add === 1); // transcript captured once despite 2 events
    cleanup();
    fx.server.close();
  });

  it("compaction hook flushes before the transcript is summarized", async () => {
    const fx = await startFixture();
    const ctx = makeSyntheticCtx({ everosUrl: fx.url });
    const cleanup = await setupPlugin(ctx as never);

    await (ctx.session as any).hooks.compaction({ sessionID: "sess-compact" });

    expect(fx.counts.flush).toBe(1);
    expect(fx.lastBodies.flush).toMatchObject({ session_id: "sess-compact" });
    cleanup();
    fx.server.close();
  });

  it("cleanup aborts the event subscription", async () => {
    const fx = await startFixture();
    const ctx = makeSyntheticCtx({ everosUrl: fx.url });
    const transcript = [userMsg("u1", "hello", 1)];
    (ctx.session as any).contextImpl = async () => [...transcript];

    const cleanup = await setupPlugin(ctx as never);
    const signal = (ctx.session as any).subscribeSignal as AbortSignal;
    expect(signal.aborted).toBe(false);

    cleanup();
    expect(signal.aborted).toBe(true);

    // Events after cleanup are ignored.
    (ctx.session as any).emit({ type: "session.text.ended", data: { sessionID: "sess-cleanup" } });
    await new Promise((r) => setTimeout(r, 100));
    expect(fx.counts.add).toBe(0);
    fx.server.close();
  });

  it("disabled option makes hooks no-ops", async () => {
    const fx = await startFixture();
    const ctx = makeSyntheticCtx({ everosUrl: fx.url, enabled: false });
    const cleanup = await setupPlugin(ctx as never);

    const input = { sessionID: "s", messages: [userMsg("u1", "hi", 1)], system: [] as Array<{ type: string; text: string }> };
    await (ctx.session as any).hooks.context(input);
    (ctx.session as any).emit({ type: "session.text.ended", data: { sessionID: "s" } });
    await new Promise((r) => setTimeout(r, 100));

    expect(fx.counts.search).toBe(0);
    expect(fx.counts.add).toBe(0);
    cleanup();
    fx.server.close();
  });
});
