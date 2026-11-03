/**
 * Identity / scoping resolution.
 *
 * - app_id:     EVEROS_APP_ID env, else "opencode"
 * - project_id: slug(basename of ctx.location.project.directory). The V2 SDK
 *               exposes no git remote URL (VcsInfo is only {provider, branch}),
 *               so the "owner-repo" idea from the plan collapses to the
 *               directory basename.
 * - user_id:    EVEROS_USER_ID env → process.env.USER → os.userInfo().username
 * - session_id: the OpenCode sessionID (≤128 chars, matches EverOS charset)
 */

import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import type { PluginContext } from "./types.js";

export interface Identity {
  appId: string;
  projectId: string;
  userId: string;
  sessionId: string;
}

/** EverOS ScopeIds charset: ^[a-zA-Z0-9_.-]+$ */
export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "project";
}

function resolveUserId(): string {
  const env = process.env.EVEROS_USER_ID;
  if (env && env.trim().length > 0) return env.trim();
  const fromEnvUser = process.env.USER;
  if (fromEnvUser && fromEnvUser.trim().length > 0) return fromEnvUser.trim();
  try {
    return nodeOs.userInfo().username;
  } catch {
    return "unknown";
  }
}

export function resolveIdentity(ctx: PluginContext): Identity {
  const appId =
    process.env.EVEROS_APP_ID?.trim() || "opencode";
  const directory = ctx.location?.project?.directory ?? "";
  const base = nodePath.basename(directory);
  const projectId = slugify(base);
  return {
    appId,
    projectId,
    userId: resolveUserId(),
    sessionId: "",
  };
}

export function withSession(identity: Omit<Identity, "sessionId">, sessionID: string): Identity {
  return { ...identity, sessionId: sessionID.slice(0, 128) };
}

export async function resolveScope(
  ctx: PluginContext,
  sessionID: string,
): Promise<{ appId: string; projectId: string; userId: string; sessionId: string }> {
  const id = resolveIdentity(ctx);
  return withSession(id, sessionID);
}
