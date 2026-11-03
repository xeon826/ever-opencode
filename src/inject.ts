/**
 * Recall formatting: EverOS episodes → compact system-prompt block.
 * Empty input yields "" (caller skips injection entirely).
 */

import type { EverosEpisode } from "./everos.js";

function relativeDate(ts: number | undefined, now: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "";
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatRecall(
  episodes: EverosEpisode[],
  opts: { topK?: number; now?: number } = {},
): string {
  const top = episodes
    .slice(0, Math.max(1, opts.topK ?? 5))
    .filter((e) => typeof e?.summary === "string" && e.summary.trim().length > 0);
  if (top.length === 0) return "";

  const now = opts.now ?? Date.now();
  const lines = top.map((e) => {
    const date = relativeDate(e.timestamp, now);
    const score = typeof e.score === "number" ? e.score.toFixed(2) : "?";
    const dateSuffix = date.length > 0 ? ` (${date})` : "";
    return `- ${e.summary.trim()} [score ${score}${dateSuffix}]`;
  });

  return [
    "<everos-recall>",
    "Relevant memories from previous sessions (may be imperfect; verify before relying on them):",
    ...lines,
    "</everos-recall>",
  ].join("\n");
}
