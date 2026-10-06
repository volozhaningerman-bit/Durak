import { describe, expect, it } from "vitest";
import {
  addRpgStartingBonus,
  assignUniqueClasses,
  chooseTrumpForMaster,
  refillPlayerHand
} from "./classes.js";
import { canBeat, getThrowInOrder, validateTransfer } from "./rules.js";
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

  it("trump master chooses one suit and moves a card of that suit to deck bottom", () => {
    const s = state({
      players: [
        player(0, { classId: "trump-master" }),
        player(1),
        player(2)
      ],
      deck: [c("6", "clubs"), c("7", "hearts"), c("8", "spades")]
    });

    const result = chooseTrumpForMaster(s, 0, "hearts");

    expect(result.trumpSuits).toEqual(["hearts"]);
    expect(result.trumpCard?.suit).toBe("hearts");
    expect(result.deck.at(-1)?.suit).toBe("hearts");
  });

  it("five-limit class only refills to five cards", () => {
    const p = player(0, {
      classId: "five-limit",
      hand: [c("6", "clubs"), c("7", "clubs"), c("8", "clubs")]
    });

    const result = refillPlayerHand(
      p,
      [c("9", "hearts"), c("10", "hearts"), c("J", "hearts"), c("Q", "hearts")]
    );

    expect(result.player.hand).toHaveLength(5);
    expect(result.deck).toHaveLength(2);
  });

  it("joker class starts with a seventh joker card", () => {
    const p = addRpgStartingBonus(player(0, { classId: "joker" }));

    expect(p.hand).toHaveLength(7);
    expect(p.hand.at(-1)?.kind).toBe("joker");
    expect(p.ability.jokerAvailable).toBe(true);
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

  it("reverse class changes both transfer target and global direction", () => {
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
    expect(result.nextDirection).toBe(-1);
  });

  it("first-thrower class gets priority before attacker and everyone else", () => {
    const s = state({
      settings: {
        mode: "rpg",
        playerCount: 4,
        variant: "transfer",
        throwInPolicy: "all",
        handSize: 6,
        ranked: false,
        gameplayItemsEnabled: true
      },
      players: [
        player(0),
        player(1),
        player(2, { classId: "first-thrower" }),
        player(3)
      ],
      attackerSeat: 0,
      defenderSeat: 1
    });

    expect(getThrowInOrder(s)).toEqual([2, 0, 3]);
  });
});
