import { describe, expect, it } from "vitest";
import { formatRecall } from "../src/inject.js";
import type { EverosEpisode } from "../src/everos.js";

const NOW = 1_800_000_000_000;

function ep(overrides: Partial<EverosEpisode> = {}): EverosEpisode {
  return { summary: "uses vitest for tests", score: 0.9, timestamp: NOW - 86_400_000, ...overrides };
}

describe("formatRecall", () => {
  it("formats compact bullets with score and relative date", () => {
    const block = formatRecall([ep()], { now: NOW });
    expect(block).toContain("<everos-recall>");
    expect(block).toContain("- uses vitest for tests [score 0.90 (yesterday)]");
    expect(block).toContain("</everos-recall>");
  });

  it("caps at topK", () => {
    const episodes = [0, 1, 2, 3].map((i) => ep({ summary: `s${i}` }));
    const block = formatRecall(episodes, { topK: 2, now: NOW });
    expect(block).toContain("s0");
    expect(block).toContain("s1");
    expect(block).not.toContain("s2");
    expect(block).not.toContain("s3");
  });

  it("returns empty string for empty or blank episodes", () => {
    expect(formatRecall([], { now: NOW })).toBe("");
    expect(formatRecall([ep({ summary: "  " })], { now: NOW })).toBe("");
  });

  it("tolerates missing scores and timestamps", () => {
    const block = formatRecall([ep({ score: undefined as never, timestamp: undefined })], { now: NOW });
    expect(block).toContain("[score ?]");
  });

  it("renders relative dates", () => {
    const today = formatRecall([ep({ timestamp: NOW - 3600_000 })], { now: NOW });
    expect(today).toContain("(today)");
    const months = formatRecall([ep({ timestamp: NOW - 120 * 86_400_000 })], { now: NOW });
    expect(months).toContain("(4mo ago)");
  });
});
