import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSIC_SETTINGS,
  DEFAULT_RPG_SETTINGS
} from "./rules.js";
import { simulateQaMatch, type QaBotStyle } from "./qaBot.js";
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
  variant: GameSettings["variant"] = "throw-in",
  throwInPolicy: GameSettings["throwInPolicy"] = "all"
): GameSettings {
  if (mode === "rpg") {
    return {
      ...DEFAULT_RPG_SETTINGS,
      playerCount,
      throwInPolicy,
      ranked: false
    };
  }

  return {
    ...DEFAULT_CLASSIC_SETTINGS,
    playerCount,
    variant,
    throwInPolicy,
    ranked: false
  };
}

describe("QA bot full-match simulation", () => {
  const playerCounts: GameSettings["playerCount"][] = [2, 3, 4, 5, 6];
  const styles: QaBotStyle[] = [
    "balanced",
    "random",
    "aggressive",
    "transfer-heavy",
    "take-heavy"
  ];
  const policies: GameSettings["throwInPolicy"][] = ["all", "neighbors"];

  for (const playerCount of playerCounts) {
    for (const variant of ["throw-in", "transfer"] as const) {
      for (const throwInPolicy of policies) {
        it(`fuzzes classic ${variant}/${throwInPolicy} with ${playerCount} players`, () => {
          for (const style of styles) {
            for (let seed = 1; seed <= 16; seed += 1) {
              const result = simulateQaMatch(
                settingsFor("classic", playerCount, variant, throwInPolicy),
                {
                  random: seededRandom(
                    seed +
                      playerCount * 10_000 +
                      styles.indexOf(style) * 1_000 +
                      (variant === "transfer" ? 100 : 0) +
                      (throwInPolicy === "neighbors" ? 10 : 0)
                  ),
                  maxActions: 2500,
                  id: `classic-${variant}-${throwInPolicy}-${playerCount}-${style}-${seed}`,
                  style
                }
              );
              expect(result.state.phase).toBe("finished");
              expect(result.actions).toBeLessThan(2500);
              expect(
                result.state.draw || result.state.loserSeat !== undefined
              ).toBe(true);
            }
          }
        });
      }
    }

    for (const throwInPolicy of policies) {
      it(`fuzzes RPG/${throwInPolicy} with ${playerCount} players`, () => {
        for (const style of styles) {
          for (let seed = 101; seed <= 116; seed += 1) {
            const result = simulateQaMatch(
              settingsFor("rpg", playerCount, "transfer", throwInPolicy),
              {
                random: seededRandom(
                  seed +
                    playerCount * 10_000 +
                    styles.indexOf(style) * 1_000 +
                    (throwInPolicy === "neighbors" ? 10 : 0)
                ),
                maxActions: 2500,
                id: `rpg-${throwInPolicy}-${playerCount}-${style}-${seed}`,
                style
              }
            );
            expect(result.state.phase).toBe("finished");
            expect(result.actions).toBeLessThan(2500);
            expect(
              result.state.draw || result.state.loserSeat !== undefined
            ).toBe(true);
          }
        }
      });
    }
  }

  it("exercises every unique RPG mechanic in deterministic fuzz coverage", () => {
    const totals = {
      trumpChoices: 0,
      wildTransfers: 0,
      reverseTransfers: 0,
      jokerDefenses: 0,
      fiveLimitStates: 0,
      firstThrowerTurns: 0
    };

    const coverageStyles: QaBotStyle[] = [
      "balanced",
      "random",
      "transfer-heavy",
      "aggressive",
      "take-heavy"
    ];

    for (let seed = 1; seed <= 160; seed += 1) {
      const style = coverageStyles[(seed - 1) % coverageStyles.length];
      const result = simulateQaMatch(
        settingsFor(
          "rpg",
          6,
          "transfer",
          seed % 2 === 0 ? "all" : "neighbors"
        ),
        {
          random: seededRandom(900_000 + seed),
          maxActions: 2500,
          id: `rpg-coverage-${seed}`,
          style
        }
      );

      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[key] += result.stats[key];
      }
    }

    expect(totals.trumpChoices).toBeGreaterThan(0);
    expect(totals.wildTransfers).toBeGreaterThan(0);
    expect(totals.reverseTransfers).toBeGreaterThan(0);
    expect(totals.jokerDefenses).toBeGreaterThan(0);
    expect(totals.fiveLimitStates).toBeGreaterThan(0);
    expect(totals.firstThrowerTurns).toBeGreaterThan(0);
  });
});
