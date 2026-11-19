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
import type { PluginContext } from "./types.js";
export interface Identity {
    appId: string;
    projectId: string;
    userId: string;
    sessionId: string;
}
/** EverOS ScopeIds charset: ^[a-zA-Z0-9_.-]+$ */
export declare function slugify(input: string): string;
export declare function resolveIdentity(ctx: PluginContext): Identity;
export declare function withSession(identity: Omit<Identity, "sessionId">, sessionID: string): Identity;
export declare function resolveScope(ctx: PluginContext, sessionID: string): Promise<{
    appId: string;
    projectId: string;
    userId: string;
    sessionId: string;
}>;
