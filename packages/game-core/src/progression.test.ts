import { describe, expect, it } from "vitest";
import {
  applyMatchProgress,
  createPlayerProgress,
  levelFromXp
} from "./progression.js";

describe("progression", () => {
  it("uses a fixed +30/-30 pool in a two-player ranked match", () => {
    const a = createPlayerProgress("a");
    const b = createPlayerProgress("b");

    const [winner, loser] = applyMatchProgress([a, b], {
      playerIds: ["a", "b"],
      loserId: "b",
      draw: false
    });

    expect(winner.rating).toBe(1030);
    expect(loser.rating).toBe(970);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
    expect(winner.currentStreak).toBe(1);
  });

  it("splits 30 rating by finish order in a six-player match", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const profiles = ids.map(createPlayerProgress);
    const result = applyMatchProgress(profiles, {
      playerIds: ids,
      loserId: "f",
      draw: false,
      winnerOrder: ["c", "a", "e", "b", "d"]
    });

    expect(result.find((profile) => profile.playerId === "c")?.rating).toBe(1010);
    expect(result.find((profile) => profile.playerId === "a")?.rating).toBe(1008);
    expect(result.find((profile) => profile.playerId === "e")?.rating).toBe(1006);
    expect(result.find((profile) => profile.playerId === "b")?.rating).toBe(1004);
    expect(result.find((profile) => profile.playerId === "d")?.rating).toBe(1002);
    expect(result.find((profile) => profile.playerId === "f")?.rating).toBe(970);
  });


  it("gives earlier finishers a larger share of the same 30 point pool", () => {
    const ids = ["a", "b", "c", "d"];
    const result = applyMatchProgress(ids.map(createPlayerProgress), {
      playerIds: ids,
      loserId: "d",
      draw: false,
      winnerOrder: ["b", "c", "a"]
    });

    expect(result.find((profile) => profile.playerId === "b")?.rating).toBe(1015);
    expect(result.find((profile) => profile.playerId === "c")?.rating).toBe(1010);
    expect(result.find((profile) => profile.playerId === "a")?.rating).toBe(1005);
    expect(result.find((profile) => profile.playerId === "d")?.rating).toBe(970);
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
