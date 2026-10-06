import { describe, expect, it } from "vitest";
import { applyGameAction, createGame } from "./engine.js";
import { canBeat, DEFAULT_CLASSIC_SETTINGS, DEFAULT_RPG_SETTINGS } from "./rules.js";
import type { GameState, PlayerState, StandardCard } from "./types.js";

const c = (rank: StandardCard["rank"], suit: StandardCard["suit"]): StandardCard => ({
  id: `${suit}-${rank}`,
  kind: "standard",
  rank,
  suit
});

function p(seat: number, hand: StandardCard[], overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: `p${seat}`,
    seat,
    hand,
    ability: { wildTransfersLeft: 0, jokerAvailable: false },
    finished: false,
    ...overrides
  };
}

function state(overrides: Partial<GameState>): GameState {
  return {
    id: "test",
    settings: {
      ...DEFAULT_CLASSIC_SETTINGS,
      playerCount: 2
    },
    phase: "attacking",
    players: [
      p(0, [c("6", "clubs")]),
      p(1, [c("7", "clubs")])
    ],
    deck: [],
    discard: [],
    trumpSuits: ["hearts"],
    trumpCard: c("6", "hearts"),
    table: [],
    attackerSeat: 0,
    defenderSeat: 1,
    turnSeat: 0,
    direction: 1,
    roundAttackLimit: 1,
    throwInPassedSeats: [],
    defenderTaking: false,
    draw: false,
    ...overrides
  };
}



function assertCardConservation(game: GameState): void {
  const cards = [
    ...game.deck,
    ...game.discard,
    ...game.players.flatMap((player) => player.hand),
    ...game.table.flatMap((pair) => pair.defense ? [pair.attack, pair.defense] : [pair.attack])
  ];

  const standardIds = cards
    .filter((card): card is StandardCard => card.kind === "standard")
    .map((card) => card.id);

  expect(standardIds).toHaveLength(36);
  expect(new Set(standardIds).size).toBe(36);

  const jokerCards = cards.filter((card) => card.kind === "joker");
  const hasJokerClass = game.players.some((player) => player.classId === "joker");
  expect(jokerCards).toHaveLength(hasJokerClass ? 1 : 0);
}

function autoPlay(initial: GameState): GameState {
  let game = initial;
  assertCardConservation(game);

  for (let step = 0; step < 10000 && game.phase !== "finished"; step += 1) {
    if (game.phase === "awaiting-trump") {
      game = applyGameAction(game, {
        type: "choose_trump",
        playerSeat: game.turnSeat!,
        suit: "hearts"
      });
      assertCardConservation(game);
      continue;
    }

    const seat = game.turnSeat;
    if (seat === undefined) throw new Error("AUTO_PLAY_MISSING_TURN");
    const player = game.players.find((entry) => entry.seat === seat)!;

    if (game.phase === "attacking") {
      const card = player.hand.find((entry) => entry.kind === "standard");
      if (!card) throw new Error("AUTO_PLAY_NO_ATTACK_CARD");
      game = applyGameAction(game, {
        type: "attack",
        playerSeat: seat,
        cardId: card.id
      });
      assertCardConservation(game);
      continue;
    }

    if (game.phase === "defending") {
      const open = game.table.find((pair) => !pair.defense);
      if (!open) throw new Error("AUTO_PLAY_NO_OPEN_ATTACK");

      const defense = player.hand.find((card) =>
        canBeat(open.attack, card, game.trumpSuits)
      );

      if (defense) {
        game = applyGameAction(game, {
          type: "defend",
          playerSeat: seat,
          attackCardId: open.attack.id,
          cardId: defense.id
        });
      } else {
        game = applyGameAction(game, {
          type: "take",
          playerSeat: seat
        });
      }
      continue;
    }

    if (game.phase === "throwing") {
      const ranks = new Set<string>();
      for (const pair of game.table) {
        if (pair.attack.kind === "standard") ranks.add(pair.attack.rank);
        if (pair.defense?.kind === "standard") ranks.add(pair.defense.rank);
      }

      const throwCard = player.hand.find(
        (card) => card.kind === "standard" && ranks.has(card.rank)
      );

      if (throwCard && game.table.length < game.roundAttackLimit) {
        game = applyGameAction(game, {
          type: "attack",
          playerSeat: seat,
          cardId: throwCard.id
        });
      } else {
        game = applyGameAction(game, {
          type: "pass_throw_in",
          playerSeat: seat
        });
      }
    }
  }

  if (game.phase !== "finished") {
    throw new Error("AUTO_PLAY_DID_NOT_FINISH");
  }

  assertCardConservation(game);
  return game;
}

describe("match engine", () => {
  it("creates a six-player RPG match with all unique classes and special hand sizes", () => {
    const game = createGame(
      ["a", "b", "c", "d", "e", "f"],
      { ...DEFAULT_RPG_SETTINGS, playerCount: 6 },
      { random: () => 0.31 }
    );

    const classes = game.players.map((player) => player.classId);
    expect(new Set(classes).size).toBe(6);
    expect(game.players.find((player) => player.classId === "five-limit")?.hand).toHaveLength(5);
    expect(game.players.find((player) => player.classId === "joker")?.hand).toHaveLength(7);
    expect(game.deck).toHaveLength(1);
    expect(game.phase).toBe("awaiting-trump");
  });

  it("starts the RPG match after trump master chooses one suit", () => {
    const game = createGame(
      ["a", "b", "c", "d", "e", "f"],
      { ...DEFAULT_RPG_SETTINGS, playerCount: 6 },
      { random: () => 0.31 }
    );
    const master = game.players.find((player) => player.classId === "trump-master")!;

    const next = applyGameAction(game, {
      type: "choose_trump",
      playerSeat: master.seat,
      suit: "hearts"
    });

    expect(next.phase).toBe("attacking");
    expect(next.trumpSuits).toEqual(["hearts"]);
    expect(next.trumpCard?.suit).toBe("hearts");
    expect(next.deck.at(-1)?.suit).toBe("hearts");
    expect(next.turnSeat).toBe(next.attackerSeat);
  });

  it("runs a successful defense and declares the remaining player the durak", () => {
    let game = state({
      players: [
        p(0, [c("6", "clubs")]),
        p(1, [c("7", "clubs"), c("9", "spades")])
      ]
    });

    game = applyGameAction(game, {
      type: "attack",
      playerSeat: 0,
      cardId: "clubs-6"
    });
    expect(game.phase).toBe("defending");

    game = applyGameAction(game, {
      type: "defend",
      playerSeat: 1,
      attackCardId: "clubs-6",
      cardId: "clubs-7"
    });

    expect(game.phase).toBe("finished");
    expect(game.loserSeat).toBe(1);
    expect(game.discard.map((card) => card.id)).toEqual(["clubs-6", "clubs-7"]);
  });

  it("lets other players throw matching cards after defender chooses to take", () => {
    let game = state({
      settings: { ...DEFAULT_CLASSIC_SETTINGS, playerCount: 3 },
      players: [
        p(0, [c("6", "clubs"), c("8", "clubs")]),
        p(1, [c("7", "hearts"), c("9", "hearts"), c("10", "hearts")]),
        p(2, [c("6", "hearts"), c("Q", "spades")])
      ],
      roundAttackLimit: 3
    });

    game = applyGameAction(game, {
      type: "attack",
      playerSeat: 0,
      cardId: "clubs-6"
    });

    game = applyGameAction(game, {
      type: "take",
      playerSeat: 1
    });

    expect(game.phase).toBe("throwing");
    expect(game.turnSeat).toBe(2);

    game = applyGameAction(game, {
      type: "attack",
      playerSeat: 2,
      cardId: "hearts-6"
    });

    expect(game.players[1].hand.map((card) => card.id)).toContain("clubs-6");
    expect(game.players[1].hand.map((card) => card.id)).toContain("hearts-6");
    expect(game.table).toHaveLength(0);
  });

  it("consumes one wild transfer and makes the old defender the attacker", () => {
    const game = state({
      settings: { ...DEFAULT_RPG_SETTINGS, playerCount: 3 },
      phase: "defending",
      players: [
        p(0, [c("K", "clubs")]),
        p(1, [c("Q", "diamonds"), c("6", "clubs")], {
          classId: "wild-transfer",
          ability: { wildTransfersLeft: 2, jokerAvailable: false }
        }),
        p(2, [c("7", "spades"), c("8", "spades"), c("9", "spades")])
      ],
      table: [{ attack: c("8", "clubs") }],
      attackerSeat: 0,
      defenderSeat: 1,
      turnSeat: 1,
      roundAttackLimit: 2
    });

    const next = applyGameAction(game, {
      type: "transfer",
      playerSeat: 1,
      cardId: "diamonds-Q"
    });

    expect(next.attackerSeat).toBe(1);
    expect(next.defenderSeat).toBe(2);
    expect(next.players[1].ability.wildTransfersLeft).toBe(1);
    expect(next.table).toHaveLength(2);
  });

  it("reverse transfer flips the whole game direction", () => {
    const game = state({
      settings: { ...DEFAULT_RPG_SETTINGS, playerCount: 3 },
      phase: "defending",
      players: [
        p(0, [c("K", "clubs"), c("Q", "clubs")]),
        p(1, [c("8", "diamonds"), c("6", "clubs")], {
          classId: "reverse-transfer"
        }),
        p(2, [c("7", "spades"), c("8", "spades")])
      ],
      table: [{ attack: c("8", "clubs") }],
      attackerSeat: 0,
      defenderSeat: 1,
      turnSeat: 1,
      roundAttackLimit: 2,
      direction: 1
    });

    const next = applyGameAction(game, {
      type: "transfer",
      playerSeat: 1,
      cardId: "diamonds-8",
      reverse: true
    });

    expect(next.direction).toBe(-1);
    expect(next.defenderSeat).toBe(0);
    expect(next.attackerSeat).toBe(1);
  });

  it("does not allow joker to be used as an attack card", () => {
    const game = state({
      players: [
        {
          ...p(0, []),
          hand: [{ id: "joker-p0", kind: "joker" }],
          classId: "joker",
          ability: { wildTransfersLeft: 0, jokerAvailable: true }
        },
        p(1, [c("7", "clubs")])
      ]
    });

    expect(() =>
      applyGameAction(game, {
        type: "attack",
        playerSeat: 0,
        cardId: "joker-p0"
      })
    ).toThrow("JOKER_DEFENSE_ONLY");

    expect(game.players[0].hand).toHaveLength(1);
  });

  it("completes classic games for every supported player count", () => {
    for (const playerCount of [2, 3, 4, 5, 6] as const) {
      const game = createGame(
        Array.from({ length: playerCount }, (_, index) => `classic-${playerCount}-${index}`),
        {
          ...DEFAULT_CLASSIC_SETTINGS,
          playerCount,
          variant: playerCount % 2 === 0 ? "throw-in" : "transfer"
        },
        { random: () => 0.27 }
      );

      const result = autoPlay(game);
      expect(result.phase).toBe("finished");
      expect(result.draw || result.loserSeat !== undefined).toBe(true);
    }
  });

  it("completes RPG games for every supported player count", () => {
    for (const playerCount of [2, 3, 4, 5, 6] as const) {
      const game = createGame(
        Array.from({ length: playerCount }, (_, index) => `rpg-${playerCount}-${index}`),
        {
          ...DEFAULT_RPG_SETTINGS,
          playerCount
        },
        { random: () => 0.41 }
      );

      const result = autoPlay(game);
      expect(result.phase).toBe("finished");
      expect(result.draw || result.loserSeat !== undefined).toBe(true);
    }
  });

  it("discards the joker after use even if the defender later takes", () => {
    let game = state({
      settings: { ...DEFAULT_RPG_SETTINGS, playerCount: 3 },
      phase: "defending",
      players: [
        p(0, [c("6", "hearts")]),
        {
          ...p(1, [c("9", "clubs")]),
          classId: "joker",
          hand: [{ id: "joker-p1", kind: "joker" }, c("9", "clubs")],
          ability: { wildTransfersLeft: 0, jokerAvailable: true }
        },
        p(2, [c("8", "spades")])
      ],
      table: [{ attack: c("8", "clubs") }],
      attackerSeat: 0,
      defenderSeat: 1,
      turnSeat: 1,
      roundAttackLimit: 2
    });

    game = applyGameAction(game, {
      type: "defend",
      playerSeat: 1,
      attackCardId: "clubs-8",
      cardId: "joker-p1"
    });

    expect(game.players[1].ability.jokerAvailable).toBe(false);
    expect(game.phase).toBe("throwing");

    game = applyGameAction(game, {
      type: "attack",
      playerSeat: 2,
      cardId: "spades-8"
    });

    game = applyGameAction(game, {
      type: "take",
      playerSeat: 1
    });

    expect(game.players[1].hand.some((card) => card.kind === "joker")).toBe(false);
    expect(game.players[1].ability.jokerAvailable).toBe(false);
    expect(game.discard.some((card) => card.kind === "joker")).toBe(true);
  });

  it("rejects transfer after the defender has already covered a card", () => {
    const game = state({
      settings: { ...DEFAULT_RPG_SETTINGS, playerCount: 3 },
      phase: "defending",
      players: [
        p(0, [c("K", "clubs")]),
        p(1, [c("8", "diamonds")]),
        p(2, [c("7", "spades"), c("8", "spades")])
      ],
      table: [{ attack: c("8", "clubs"), defense: c("9", "clubs") }],
      attackerSeat: 0,
      defenderSeat: 1,
      turnSeat: 1,
      roundAttackLimit: 2
    });

    expect(() =>
      applyGameAction(game, {
        type: "transfer",
        playerSeat: 1,
        cardId: "diamonds-8"
      })
    ).toThrow("ALREADY_DEFENDED");
  });
});
