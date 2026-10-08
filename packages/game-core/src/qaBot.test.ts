import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSIC_SETTINGS,
  DEFAULT_RPG_SETTINGS
} from "./rules.js";
import { simulateQaMatch } from "./qaBot.js";
import type { GameSettings } from "./types.js";

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function settingsFor(
  mode: "classic" | "rpg",
  playerCount: GameSettings["playerCount"],
  variant: GameSettings["variant"] = "throw-in"
): GameSettings {
  if (mode === "rpg") {
    return {
      ...DEFAULT_RPG_SETTINGS,
      playerCount,
      ranked: false
    };
  }

  return {
    ...DEFAULT_CLASSIC_SETTINGS,
    playerCount,
    variant,
    ranked: false
  };
}

describe("QA bot full-match simulation", () => {
  const playerCounts: GameSettings["playerCount"][] = [2, 3, 4, 5, 6];

  for (const playerCount of playerCounts) {
    for (const variant of ["throw-in", "transfer"] as const) {
      it(`finishes classic ${variant} with ${playerCount} players across seeds`, () => {
        for (let seed = 1; seed <= 12; seed += 1) {
          const result = simulateQaMatch(
            settingsFor("classic", playerCount, variant),
            { random: seededRandom(seed), maxActions: 2500, id: `classic-${variant}-${playerCount}-${seed}` }
          );
          expect(result.state.phase).toBe("finished");
          expect(result.actions).toBeLessThan(2500);
          expect(result.state.draw || result.state.loserSeat !== undefined).toBe(true);
        }
      });
    }

    it(`finishes RPG with ${playerCount} players across seeds`, () => {
      for (let seed = 101; seed <= 112; seed += 1) {
        const result = simulateQaMatch(
          settingsFor("rpg", playerCount),
          { random: seededRandom(seed), maxActions: 2500, id: `rpg-${playerCount}-${seed}` }
        );
        expect(result.state.phase).toBe("finished");
        expect(result.actions).toBeLessThan(2500);
        expect(result.state.draw || result.state.loserSeat !== undefined).toBe(true);
      }
    });
  }
});
