import { afterEach, describe, expect, it } from "vitest";
import { resolveIdentity, slugify, withSession } from "../src/identity.js";
import type { PluginContext } from "../src/types.js";

function fakeCtx(directory: string): PluginContext {
  return {
    options: {},
    location: { project: { directory } },
    storage: { get: async () => undefined, set: async () => {}, remove: async () => {} },
    event: { subscribe: async function* () {} },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      context: async () => [],
    },
  };
}

const ENV_KEYS = ["EVEROS_USER_ID", "EVEROS_APP_ID", "USER"] as const;

function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void): void {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) {
      if (k in env) process.env[k] = env[k];
    }
    fn();
  } finally {
    for (const k of ENV_KEYS) process.env[k] = saved[k];
  }
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("slugify", () => {
  it("keeps EverOS ScopeIds charset [a-zA-Z0-9_.-]", () => {
    expect(slugify("my-repo.js_v2")).toBe("my-repo.js_v2");
  });

  it("replaces other characters and trims separators", () => {
    expect(slugify("/home/user/My Project!")).toBe("home-user-my-project");
    expect(slugify("  --odd..name--  ")).toBe("odd..name");
  });

  it("bounds length and never returns empty", () => {
    expect(slugify("a".repeat(100)).length).toBe(64);
    expect(slugify("///")).toBe("project");
  });
});

describe("resolveIdentity", () => {
  it("resolves app/user/project from env with fallbacks", () => {
    withEnv({ EVEROS_APP_ID: "myapp", EVEROS_USER_ID: "eve" }, () => {
      const id = resolveIdentity(fakeCtx("/home/eve/work/cool-repo"));
      expect(id.appId).toBe("myapp");
      expect(id.userId).toBe("eve");
      expect(id.projectId).toBe("cool-repo");
    });
  });

  it("falls back to USER env, then default app", () => {
    withEnv({ USER: "fallback" }, () => {
      const id = resolveIdentity(fakeCtx("/x/y/z"));
      expect(id.userId).toBe("fallback");
      expect(id.appId).toBe("opencode");
    });
  });
});

describe("withSession", () => {
  it("clamps session id to 128 chars", () => {
    const id = withSession({ appId: "opencode", projectId: "p", userId: "u" }, "s".repeat(200));
    expect(id.sessionId.length).toBe(128);
  });
});
