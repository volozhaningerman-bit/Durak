import { describe, expect, it } from "vitest";
import {
  applyMatchProgress,
  createPlayerProgress,
  levelFromXp
} from "./progression.js";

describe("progression", () => {
  it("updates a two-player match like a standard Elo duel", () => {
    const a = createPlayerProgress("a");
    const b = createPlayerProgress("b");

    const [winner, loser] = applyMatchProgress([a, b], {
      playerIds: ["a", "b"],
      loserId: "b",
      draw: false
    });

    expect(winner.rating).toBe(1016);
    expect(loser.rating).toBe(984);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
    expect(winner.currentStreak).toBe(1);
  });

  it("shares rating gain across five winners in a six-player match", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const profiles = ids.map(createPlayerProgress);
    const result = applyMatchProgress(profiles, {
      playerIds: ids,
      loserId: "f",
      draw: false
    });

    expect(result.filter((profile) => profile.playerId !== "f").every((profile) => profile.rating === 1003.2)).toBe(true);
    expect(result.find((profile) => profile.playerId === "f")?.rating).toBe(984);
  });

  it("resets streaks on a draw without changing rating", () => {
    const profile = {
      ...createPlayerProgress("a"),
      currentStreak: 4,
      bestStreak: 4
    };

    const [result] = applyMatchProgress([profile], {
      playerIds: ["a"],
      draw: true
    });

    expect(result.rating).toBe(1000);
    expect(result.draws).toBe(1);
    expect(result.currentStreak).toBe(0);
  });

  it("levels up every 500 xp", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(499)).toBe(1);
    expect(levelFromXp(500)).toBe(2);
    expect(levelFromXp(1500)).toBe(4);
  });
});
