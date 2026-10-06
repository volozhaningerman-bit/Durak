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

    expect(winner.rating).toBe(1020);
    expect(loser.rating).toBe(980);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
    expect(winner.currentStreak).toBe(1);
  });

  it("shares the loser pool across five winners in a six-player match", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const profiles = ids.map(createPlayerProgress);
    const result = applyMatchProgress(profiles, {
      playerIds: ids,
      loserId: "f",
      draw: false
    });

    expect(result.filter((profile) => profile.playerId !== "f").every((profile) => profile.rating === 1007)).toBe(true);
    expect(result.find((profile) => profile.playerId === "f")?.rating).toBe(965);
  });

  it("makes a favourite lose more rating than an underdog", () => {
    const strongLoser = {
      ...createPlayerProgress("strong"),
      rating: 1400
    };
    const weakWinner = {
      ...createPlayerProgress("weak"),
      rating: 1000
    };
    const [winnerVsStrong, loserStrong] = applyMatchProgress(
      [weakWinner, strongLoser],
      {
        playerIds: ["weak", "strong"],
        loserId: "strong",
        draw: false
      }
    );

    const weakLoser = {
      ...createPlayerProgress("weak-loser"),
      rating: 1000
    };
    const strongWinner = {
      ...createPlayerProgress("strong-winner"),
      rating: 1400
    };
    const [winnerVsWeak, loserWeak] = applyMatchProgress(
      [strongWinner, weakLoser],
      {
        playerIds: ["strong-winner", "weak-loser"],
        loserId: "weak-loser",
        draw: false
      }
    );

    expect(1400 - loserStrong.rating).toBeGreaterThan(1000 - loserWeak.rating);
    expect(winnerVsStrong.rating - 1000).toBeGreaterThan(winnerVsWeak.rating - 1400);
  });

  it("never drops rating below the floor", () => {
    const loser = {
      ...createPlayerProgress("loser"),
      rating: 105
    };
    const winner = createPlayerProgress("winner");

    const result = applyMatchProgress([winner, loser], {
      playerIds: ["winner", "loser"],
      loserId: "loser",
      draw: false
    });

    expect(result.find((profile) => profile.playerId === "loser")?.rating).toBe(100);
    expect(result.find((profile) => profile.playerId === "winner")?.rating).toBe(1005);
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

  it("keeps Elo unchanged in casual matches while updating progression", () => {
    const a = createPlayerProgress("a");
    const b = createPlayerProgress("b");

    const [winner, loser] = applyMatchProgress([a, b], {
      playerIds: ["a", "b"],
      loserId: "b",
      draw: false,
      ranked: false
    });

    expect(winner.rating).toBe(1000);
    expect(loser.rating).toBe(1000);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
    expect(winner.xp).toBeGreaterThan(0);
    expect(loser.xp).toBeGreaterThan(0);
  });

  it("levels up every 500 xp", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(499)).toBe(1);
    expect(levelFromXp(500)).toBe(2);
    expect(levelFromXp(1500)).toBe(4);
  });
});
