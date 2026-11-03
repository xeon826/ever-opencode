/**
 * Synthetic plugin context for contract tests: in-memory storage, manual
 * event emission, captured session hooks, and a swappable transcript.
 */

import type { EverosEvent, PluginContext } from "../src/types.js";

export type { PluginContext, EverosEvent };

export interface SyntheticCtx extends PluginContext {
  session: PluginContext["session"] & {
    /** Backing transcript returned by `context()`. */
    contextImpl: (input: { sessionID: string }) => Promise<unknown[]>;
    /** Registered hook callbacks, by name. */
    hooks: Record<string, (input: any) => Promise<void> | void>;
    /** AbortSignal passed to event.subscribe(). */
    subscribeSignal: AbortSignal | undefined;
    /** Manually emit an event into the subscription stream. */
    emit(event: EverosEvent): void;
  };
}

export interface SyntheticOptions {
  everosUrl: string;
  enabled?: boolean;
  logLevel?: "debug" | "info" | "error" | "silent";
  [key: string]: unknown;
}

export function makeSyntheticCtx(options: SyntheticOptions): SyntheticCtx {
  const storage = new Map<string, unknown>();
  const hooks: Record<string, (input: any) => Promise<void> | void> = {};
  let subscribeSignal: AbortSignal | undefined;
  let notify: (() => void) | null = null;
  const queue: EverosEvent[] = [];
  const contextImpl = { fn: async (_input: { sessionID: string }) => [] as unknown[] };

  const ctx: SyntheticCtx = {
    options: { ...options },
    location: { project: { directory: "/home/tester/projects/demo-repo" } },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, value);
      },
      remove: async (key) => {
        storage.delete(key);
      },
    },
    event: {
      subscribe: (opts) => {
        subscribeSignal = opts?.signal;
        async function* stream(): AsyncIterable<EverosEvent> {
          while (true) {
            if (queue.length > 0) {
              yield queue.shift()!;
              continue;
            }
            if (subscribeSignal?.aborted) return;
            await new Promise<void>((resolve) => (notify = resolve));
          }
        }
        return stream();
      },
    },
    session: {
      hook: async (name: string, callback: (input: any) => Promise<void> | void) => {
        hooks[name] = callback;
        return { dispose: async () => { delete hooks[name]; } };
      },
      context: (input: { sessionID: string }) => contextImpl.fn(input),
      hooks,
      get subscribeSignal() {
        return subscribeSignal;
      },
      emit(event: EverosEvent) {
        if (subscribeSignal?.aborted) return;
        queue.push(event);
        notify?.();
        notify = null;
      },
    },
  };

  // contextImpl is exposed for tests to swap the transcript per test.
  Object.defineProperty(ctx.session, "contextImpl", {
    get: () => contextImpl.fn,
    set: (fn: (input: { sessionID: string }) => Promise<unknown[]>) => {
      contextImpl.fn = fn;
    },
  });

  Object.defineProperty(ctx.session, "subscribeSignal", {
    get: () => subscribeSignal,
  });

  return ctx;
}
