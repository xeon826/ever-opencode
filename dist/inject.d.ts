/**
 * Recall formatting: EverOS episodes → compact system-prompt block.
 * Empty input yields "" (caller skips injection entirely).
 */
import type { EverosEpisode } from "./everos.js";
/**
 * Render episodes as `- summary [score X (age)]` lines — the single
 * representation shared by system-prompt recall and the agent tools.
 * Empty input yields [].
 */
export declare function formatEpisodeLines(episodes: EverosEpisode[], opts?: {
    topK?: number;
    now?: number;
}): string[];
export declare function formatRecall(episodes: EverosEpisode[], opts?: {
    topK?: number;
    now?: number;
}): string;
