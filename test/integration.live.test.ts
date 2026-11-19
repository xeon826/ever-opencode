/**
 * Live integration harness against a real EverOS server.
 *
 * Gated behind EVEROS_INTEGRATION=1 so the default `npm test` run stays
 * hermetic (the harness writes to the real store and spends a real LLM
 * extraction). Run explicitly:
 *
 *   npm run test:integration
 *
 * Flow: health probe (skips when the server is down) → add a distinctive fact
 * into a throwaway app scope → flush (synchronous extraction) → search →
 * assert the fact surfaces. Writes are isolated under
 * `~/.everos/<store>/<app scope>` and never touch project memory.
 */

import { describe, expect, it } from "vitest";
import { EverosClient } from "../src/everos.js";

const BASE = process.env.EVEROS_URL ?? "http://127.0.0.1:8000";
const APP_SCOPE = `everos-integration-${Date.now().toString(36)}`;
const SESSION = `itest-${Date.now().toString(36)}`;
const FACT = `integration probe: the zebra comet launch codename is ZEBRA-COMET-42`;

const enabled = process.env.EVEROS_INTEGRATION === "1";

describe.skipIf(!enabled || (await isServerDown()))("everos live integration", () => {
  it("health reports ok", async () => {
    const client = new EverosClient(BASE);
    const health = await client.health();
    expect(health.status).toBeTruthy();
  });

  it("add → flush → search round-trips through real extraction", { timeout: 120_000 }, async () => {
    const client = new EverosClient(BASE);
    const scope = { session_id: SESSION, app_id: APP_SCOPE };

    await client.addMemory(
      scope,
      [{ sender_id: "itest", role: "user", timestamp: Date.now(), content: FACT }],
      { deferExtraction: true },
    );
    await client.flushMemory(scope, 90_000);

    // Extraction is LLM-side and may lag the flush response by a moment.
    let found: string | undefined;
    for (let attempt = 0; attempt < 5 && !found; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      const episodes = await client.searchMemories("itest", "zebra comet launch codename", {
        method: "keyword",
        topK: 5,
        scope: { appId: APP_SCOPE },
      });
      found = episodes.find((e) => e.summary.includes("ZEBRA-COMET-42"))?.summary;
    }
    expect(found, "flushed fact should surface in search results").toBeTruthy();
  });
});

async function isServerDown(): Promise<boolean> {
  try {
    const client = new EverosClient(BASE);
    await client.health(2000);
    return false;
  } catch {
    console.warn(`[integration] EverOS server unreachable at ${BASE} — skipping.`);
    return true;
  }
}
