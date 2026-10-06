import { describe, expect, it } from "vitest";
import { assignUniqueClasses } from "./classes.js";
import { canBeat, validateTransfer } from "./rules.js";
import type { GameState, PlayerState, StandardCard } from "./types.js";

const c = (rank: StandardCard["rank"], suit: StandardCard["suit"]): StandardCard => ({
  id: `${suit}-${rank}`,
  kind: "standard",
  rank,
  suit
});

function player(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: `p${seat}`,
    seat,
    hand: [c("6", "clubs"), c("7", "clubs"), c("8", "clubs"), c("9", "clubs"), c("10", "clubs"), c("J", "clubs")],
    ability: { wildTransfersLeft: 0, jokerAvailable: false },
    finished: false,
    ...overrides
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    id: "game",
    settings: {
      mode: "rpg",
      playerCount: 3,
      variant: "transfer",
      throwInPolicy: "all",
      handSize: 6,
      ranked: false,
      gameplayItemsEnabled: true
    },
    players: [player(0), player(1), player(2)],
    deck: [],
    trumpSuits: ["hearts"],
    table: [{ attack: c("8", "spades") }],
    attackerSeat: 0,
    defenderSeat: 1,
    direction: 1,
    ...overrides
  };
}

describe("RPG classes", () => {
  it("assigns unique classes", () => {
    const assigned = Object.values(assignUniqueClasses(["a", "b", "c", "d", "e", "f"], () => 0.42));
    expect(new Set(assigned).size).toBe(6);
  });

  it("joker beats any standard card", () => {
    expect(canBeat(c("A", "hearts"), { id: "joker", kind: "joker" }, ["hearts"])).toBe(true);
  });

  it("wild-transfer class can transfer with a different rank twice", () => {
    const s = state();
    s.players[1] = player(1, {
      classId: "wild-transfer",
      ability: { wildTransfersLeft: 2, jokerAvailable: false }
    });

    const result = validateTransfer(s, {
      playerSeat: 1,
      card: c("Q", "diamonds")
    });

    expect(result.ok).toBe(true);
    expect(result.consumesWildTransfer).toBe(true);
    expect(result.nextDefenderSeat).toBe(2);
  });

  it("reverse class can transfer against play direction", () => {
    const s = state();
    s.players[1] = player(1, {
      classId: "reverse-transfer",
      hand: [c("8", "diamonds"), c("6", "clubs"), c("7", "clubs")]
    });

    const result = validateTransfer(s, {
      playerSeat: 1,
      card: c("8", "diamonds"),
      reverse: true
    });

    expect(result.ok).toBe(true);
    expect(result.nextDefenderSeat).toBe(0);
  });
});
