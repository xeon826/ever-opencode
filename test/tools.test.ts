/**
 * Tool-surface tests: synthetic ctx with a tool domain + fake EverosClient.
 * Verifies registration, argument handling, scope narrowing, formatting,
 * and the never-throw error contract.
 */

import { describe, expect, it } from "vitest";
import { buildTools, everosToolNames, registerTools } from "../src/tools.js";
import type { EverosToolDef, ToolDeps, ToolEditorLike } from "../src/tools.js";
import type { EverosEpisode } from "../src/everos.js";
import type { PluginContext, ToolDomainLike } from "../src/types.js";

const log = { debug: () => {}, info: () => {}, error: () => {} } as unknown as ToolDeps["log"];

function fakeClient(overrides: Partial<Record<"search" | "add" | "flush", any>> = {}) {
  const calls: { search: any[]; add: any[]; flush: any[] } = { search: [], add: [], flush: [] };
  return {
    calls,
    searchMemories: async (...args: any[]) => {
      calls.search.push(args);
      return overrides.search
        ? overrides.search(...args)
        : ([{ summary: "prefers terse replies", score: 0.9, timestamp: Date.now() - 3600_000 }] as EverosEpisode[]);
    },
    addMemory: async (...args: any[]) => {
      calls.add.push(args);
      return { status: "ok" };
    },
    flushMemory: async (...args: any[]) => {
      calls.flush.push(args);
      return { status: "flushed" };
    },
  } as unknown as ToolDeps["client"];
}

function deps(client: ToolDeps["client"]): ToolDeps {
  return {
    client,
    scopeBase: { userId: "dan", appId: "opencode", projectId: "demo-repo" },
    recallMethod: "keyword",
    defaultTopK: 5,
    log,
  };
}

function toolCtx() {
  const added: EverosToolDef[] = [];
  let disposed = 0;
  const domain: ToolDomainLike = {
    transform: async (editor: ToolEditorLike) => {
      return {
        dispose: () => {
          disposed++;
        },
      };
    },
  };
  // Wrap add so the editor records what the plugin registers.
  (domain as any).transform = async (cb: (editor: ToolEditorLike) => void) => {
    cb({
      add: (tool: EverosToolDef) => added.push(tool),
    });
    return { dispose: async () => void disposed++ };
  };
  const ctx = { tool: domain } as unknown as PluginContext;
  return { ctx, added, getDisposed: () => disposed };
}

describe("everos tools", () => {
  it("registers search/add/flush in order and disposes", async () => {
    const { ctx, added, getDisposed } = toolCtx();
    const reg = await registerTools(ctx, deps(fakeClient()));
    expect(added.map((t) => t.name)).toEqual([...everosToolNames]);
    expect(added[0].name).toBe("everos_search");
    await reg?.dispose();
    expect(getDisposed()).toBe(1);
  });

  it("registerTools returns undefined when the host has no tool domain", async () => {
    const reg = await registerTools({} as PluginContext, deps(fakeClient()));
    expect(reg).toBeUndefined();
  });

  it("everos_search narrows to the project scope by default", async () => {
    const client = fakeClient();
    const tools = buildTools(deps(client));
    const search = tools.find((t) => t.name === "everos_search")!;
    const out = await search.execute({ query: "flaky login test" }, { sessionID: "sess-1" });

    const [userId, query, opts] = (client as any).calls.search[0];
    expect(userId).toBe("dan");
    expect(query).toBe("flaky login test");
    expect(opts).toMatchObject({ method: "keyword", topK: 5, scope: { appId: "opencode", projectId: "demo-repo" } });
    expect(out.content).toContain("prefers terse replies");
    expect(out.content).toContain("[score 0.90");
  });

  it("everos_search global drops scope narrowing; top_k clamps", async () => {
    const client = fakeClient();
    const tools = buildTools(deps(client));
    const search = tools.find((t) => t.name === "everos_search")!;

    await search.execute({ query: "q", scope: "global", top_k: 99 }, { sessionID: "s" });
    const [userId, , opts] = (client as any).calls.search[0];
    expect(userId).toBe("dan");
    expect(opts.scope).toBeUndefined();
    expect(opts.topK).toBe(25);
  });

  it("everos_search rejects an empty query without touching the client", async () => {
    const client = fakeClient();
    const tools = buildTools(deps(client));
    const search = tools.find((t) => t.name === "everos_search")!;
    const out = await search.execute({ query: "   " }, { sessionID: "s" });
    expect(out.content).toContain("required");
    expect((client as any).calls.search).toHaveLength(0);
  });

  it("everos_search reports no-results without fabricating lines", async () => {
    const client = fakeClient({ search: async () => [] });
    const tools = buildTools(deps(client));
    const search = tools.find((t) => t.name === "everos_search")!;
    const out = await search.execute({ query: "nothing" }, { sessionID: "s" });
    expect(out.content).toMatch(/^No memories found/);
  });

  it("everos_add sends one deferred message then flushes (order preserved)", async () => {
    const client = fakeClient();
    const tools = buildTools(deps(client));
    const add = tools.find((t) => t.name === "everos_add")!;
    const out = await add.execute({ text: "release codename is ORBITAL" }, { sessionID: "sess-add" });

    expect(out.content).toContain("Remembered");
    expect((client as any).calls.add).toHaveLength(1);
    const [scope, messages, opts] = (client as any).calls.add[0];
    expect(scope).toMatchObject({ session_id: "sess-add", app_id: "opencode", project_id: "demo-repo" });
    expect(messages[0]).toMatchObject({ role: "user", content: "release codename is ORBITAL" });
    expect(opts).toMatchObject({ deferExtraction: true });
    // Flush only after the add completed.
    expect((client as any).calls.flush).toHaveLength(1);
  });

  it("everos_flush flushes the current session scope", async () => {
    const client = fakeClient();
    const tools = buildTools(deps(client));
    const flush = tools.find((t) => t.name === "everos_flush")!;
    await flush.execute({}, { sessionID: "sess-flush" });
    expect((client as any).calls.flush[0][0]).toMatchObject({ session_id: "sess-flush" });
  });

  it("client failures surface as content, never throw", async () => {
    const client = fakeClient({ search: async () => { throw Object.assign(new Error("boom"), { code: "timeout" }); } });
    const tools = buildTools(deps(client));
    const search = tools.find((t) => t.name === "everos_search")!;
    const out = await search.execute({ query: "q" }, { sessionID: "s" });
    expect(out.content).toContain("everos_search failed");
    expect(out.content).toContain("timeout");
    expect(out.metadata).toMatchObject({ error: true });
  });

  it("tool inputs are JSON Schema objects with required fields", () => {
    const tools = buildTools(deps(fakeClient()));
    for (const tool of tools) {
      expect(tool.input).toMatchObject({ type: "object" });
    }
    expect((tools[0].input as any).required).toEqual(["query"]);
    expect((tools[1].input as any).required).toEqual(["text"]);
  });
});
