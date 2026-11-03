/**
 * Minimal structural interfaces for the subset of the OpenCode V2 plugin
 * context this plugin uses. Kept local so the plugin core stays unit-testable
 * with a synthetic context; the real SDK types are structurally compatible.
 */

/** Plugin options (all optional; see README / AGENTS.md). */
export interface EverosOptions {
  everosUrl?: string;
  flushEvery?: number;
  topK?: number;
  recallMethod?: string;
  enabled?: boolean;
  logLevel?: "debug" | "info" | "error" | "silent";
}

/** Subset of `ctx.storage` used here (JSON values in and out). */
export interface StorageLike {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface EventSubscribeOptions {
  readonly types?: readonly string[];
  readonly signal?: AbortSignal;
}

/** Subset of `ctx.event`. */
export interface EventDomainLike {
  subscribe(options?: EventSubscribeOptions): AsyncIterable<EverosEvent>;
}

/** OpenCode V2 event shape (subset we inspect). Resilient: extra fields ignored. */
export interface EverosEvent {
  type: string;
  data?: {
    sessionID?: string;
    [key: string]: unknown;
  };
}

export interface RegistrationLike {
  dispose(): Promise<void> | void;
}

/** Subset of `ctx.session`. */
export interface SessionDomainLike {
  /** Register a session hook; returns a registration that can be disposed. */
  hook(
    name: string,
    callback: (input: any) => Promise<void> | void,
  ): Promise<RegistrationLike>;
  /** Full transcript for a session, newest appended: OpenCode `SessionMessageInfo[]`. */
  context(input: { sessionID: string }): Promise<unknown[]>;
}

/** Subset of `ctx.vcs` (optional — absent when no VCS is detected). */
export interface VcsDomainLike {
  get(input?: Record<string, unknown>): Promise<unknown>;
}

/** Structural view of the V2 plugin setup context. */
export interface PluginContext {
  readonly options: Readonly<Record<string, unknown>>;
  readonly location: {
    readonly project: {
      readonly directory: string;
    };
  };
  readonly storage: StorageLike;
  readonly event: EventDomainLike;
  readonly session: SessionDomainLike;
  readonly vcs?: VcsDomainLike;
}
