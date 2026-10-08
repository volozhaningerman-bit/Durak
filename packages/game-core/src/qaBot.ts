import { applyGameAction, createGame } from "./engine.js";
import { RPG_CLASSES } from "./classes.js";
import type {
  Card,
  GameAction,
  GameSettings,
  GameState,
  StandardCard,
  Suit
} from "./types.js";

const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];

export type QaBotStyle =
  | "balanced"
  | "random"
  | "aggressive"
  | "transfer-heavy"
  | "take-heavy";

function cardWeight(card: Card, state: GameState): number {
  if (card.kind === "joker") return 10_000;
  const rankWeight: Record<StandardCard["rank"], number> = {
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
  };
  return rankWeight[card.rank] + (state.trumpSuits.includes(card.suit) ? 100 : 0);
}

export function enumerateLegalActions(
  state: GameState,
  playerSeat: number
): GameAction[] {
  if (state.phase === "finished" || state.turnSeat !== playerSeat) return [];

  const player = state.players.find((entry) => entry.seat === playerSeat);
  if (!player || player.finished) return [];

  const candidates: GameAction[] = [];

  if (state.phase === "awaiting-trump") {
    for (const suit of SUITS) {
      candidates.push({ type: "choose_trump", playerSeat, suit });
    }
  }

  for (const card of player.hand) {
    candidates.push({ type: "attack", playerSeat, cardId: card.id });
    candidates.push({ type: "transfer", playerSeat, cardId: card.id });
    candidates.push({ type: "transfer", playerSeat, cardId: card.id, reverse: true });

    for (const pair of state.table) {
      if (pair.defense) continue;
      candidates.push({
        type: "defend",
        playerSeat,
        attackCardId: pair.attack.id,
        cardId: card.id
      });
    }
  }

  candidates.push({ type: "take", playerSeat });
  candidates.push({ type: "pass_throw_in", playerSeat });

  return candidates.filter((action) => {
    try {
      applyGameAction(state, action);
      return true;
    } catch {
      return false;
    }
  });
}

function chooseTrump(
  state: GameState,
  actions: Extract<GameAction, { type: "choose_trump" }>[]
): GameAction {
  const player = state.players.find((entry) => entry.seat === state.turnSeat);
  const suitCounts = new Map<Suit, number>(SUITS.map((suit) => [suit, 0]));

  for (const card of player?.hand ?? []) {
    if (card.kind === "standard") {
      suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
    }
  }

  return [...actions].sort(
    (a, b) => (suitCounts.get(b.suit) ?? 0) - (suitCounts.get(a.suit) ?? 0)
  )[0];
}

function lowestCardAction(
  state: GameState,
  actions: Array<
    Extract<GameAction, { type: "attack" | "defend" | "transfer" }>
  >
): GameAction {
  const player = state.players.find((entry) => entry.seat === state.turnSeat);
  const byId = new Map((player?.hand ?? []).map((card) => [card.id, card]));
  return [...actions].sort((a, b) => {
    const aCard = byId.get(a.cardId);
    const bCard = byId.get(b.cardId);
    return (
      (aCard ? cardWeight(aCard, state) : Number.MAX_SAFE_INTEGER) -
      (bCard ? cardWeight(bCard, state) : Number.MAX_SAFE_INTEGER)
    );
  })[0];
}

function randomAction(
  actions: readonly GameAction[],
  random: () => number
): GameAction {
  return actions[Math.min(actions.length - 1, Math.floor(random() * actions.length))];
}

export function chooseQaBotAction(
  state: GameState,
  playerSeat: number,
  random: () => number = Math.random,
  style: QaBotStyle = "balanced"
): GameAction | undefined {
  const legal = enumerateLegalActions(state, playerSeat);
  if (legal.length === 0) return undefined;

  if (style === "random") return randomAction(legal, random);

  const trump = legal.filter(
    (action): action is Extract<GameAction, { type: "choose_trump" }> =>
      action.type === "choose_trump"
  );
  if (trump.length > 0) return chooseTrump(state, trump);

  const attacks = legal.filter(
    (action): action is Extract<GameAction, { type: "attack" }> =>
      action.type === "attack"
  );
  const defenses = legal.filter(
    (action): action is Extract<GameAction, { type: "defend" }> =>
      action.type === "defend"
  );
  const transfers = legal.filter(
    (action): action is Extract<GameAction, { type: "transfer" }> =>
      action.type === "transfer"
  );
  const take = legal.find((action) => action.type === "take");
  const pass = legal.find((action) => action.type === "pass_throw_in");

  if (state.phase === "attacking") {
    return attacks.length > 0 ? lowestCardAction(state, attacks) : legal[0];
  }

  if (state.phase === "defending") {
    if (style === "take-heavy" && take && random() < 0.72) return take;

    if (style === "transfer-heavy" && transfers.length > 0) {
      const reverse = transfers.filter((action) => action.reverse === true);
      const pool = reverse.length > 0 && random() < 0.55 ? reverse : transfers;
      return lowestCardAction(state, pool);
    }

    if (style === "aggressive" && defenses.length > 0) {
      return lowestCardAction(state, defenses);
    }

    // Balanced play still exercises transfers regularly.
    if (transfers.length > 0 && random() < 0.28) {
      const reverse = transfers.filter((action) => action.reverse === true);
      const pool = reverse.length > 0 && random() < 0.35 ? reverse : transfers;
      return lowestCardAction(state, pool);
    }
    if (defenses.length > 0) return lowestCardAction(state, defenses);
    if (transfers.length > 0) return lowestCardAction(state, transfers);

    return take ?? legal[0];
  }

  if (state.phase === "throwing") {
    if (style === "aggressive" && attacks.length > 0) {
      return lowestCardAction(state, attacks);
    }
    if (style === "take-heavy" && pass) return pass;

    if (attacks.length > 0 && (!pass || random() < 0.58)) {
      return lowestCardAction(state, attacks);
    }
    return pass ?? legal[0];
  }

  return legal[0];
}

function physicalCards(state: GameState): Card[] {
  return [
    ...state.deck,
    ...state.discard,
    ...state.players.flatMap((player) => player.hand),
    ...state.table.flatMap((pair) =>
      pair.defense ? [pair.attack, pair.defense] : [pair.attack]
    )
  ];
}

export function assertQaStateInvariants(state: GameState): void {
  const cards = physicalCards(state);
  const ids = cards.map((card) => card.id);
  const unique = new Set(ids);
  const jokerPlayers = state.players.filter((player) => player.classId === "joker");
  const expectedCards = 36 + jokerPlayers.length;

  if (cards.length !== expectedCards) {
    throw new Error(
      `QA_CARD_COUNT:${cards.length}/${expectedCards}:phase=${state.phase}`
    );
  }
  if (unique.size !== ids.length) {
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    throw new Error(`QA_DUPLICATE_CARD:${duplicate ?? "unknown"}`);
  }

  const standardIds = cards
    .filter((card): card is StandardCard => card.kind === "standard")
    .map((card) => card.id);
  if (standardIds.length !== 36 || new Set(standardIds).size !== 36) {
    throw new Error(`QA_STANDARD_DECK_CORRUPTED:${standardIds.length}`);
  }

  for (const pair of state.table) {
    if (pair.attack.kind !== "standard") {
      throw new Error(`QA_JOKER_ATTACK:${pair.attack.id}`);
    }
  }

  if (state.settings.mode === "classic") {
    if (state.players.some((player) => player.classId !== undefined)) {
      throw new Error("QA_CLASS_IN_CLASSIC");
    }
    if (cards.some((card) => card.kind === "joker")) {
      throw new Error("QA_JOKER_IN_CLASSIC");
    }
  } else {
    const classes = state.players
      .map((player) => player.classId)
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    if (classes.length !== state.players.length) {
      throw new Error("QA_RPG_CLASS_MISSING");
    }
    if (new Set(classes).size !== classes.length) {
      throw new Error("QA_RPG_CLASS_DUPLICATE");
    }
    if (classes.some((classId) => !RPG_CLASSES.includes(classId))) {
      throw new Error("QA_RPG_CLASS_UNKNOWN");
    }
  }

  for (const player of state.players) {
    if (player.finished && player.hand.length !== 0) {
      throw new Error(`QA_FINISHED_WITH_HAND:seat=${player.seat}`);
    }

    if (player.classId === "joker") {
      const jokerInHand = player.hand.some((card) => card.kind === "joker");
      if (player.ability.jokerAvailable !== jokerInHand) {
        throw new Error(
          `QA_JOKER_ABILITY_DESYNC:seat=${player.seat}:hand=${jokerInHand}`
        );
      }
    }
  }

  const activeSeats = new Set(
    state.players.filter((player) => !player.finished).map((player) => player.seat)
  );

  if (state.phase === "finished") {
    if (state.turnSeat !== undefined) throw new Error("QA_FINISHED_HAS_TURN");
    if (state.table.length !== 0) throw new Error("QA_FINISHED_HAS_TABLE");
    if (state.draw) {
      if (activeSeats.size !== 0 || state.loserSeat !== undefined) {
        throw new Error("QA_INVALID_DRAW");
      }
    } else {
      if (
        activeSeats.size !== 1 ||
        state.loserSeat === undefined ||
        !activeSeats.has(state.loserSeat)
      ) {
        throw new Error("QA_INVALID_LOSER");
      }
    }
    return;
  }

  if (state.turnSeat === undefined) {
    throw new Error(`QA_LIVE_NO_TURN:${state.phase}`);
  }
  if (!activeSeats.has(state.turnSeat)) {
    throw new Error(`QA_TURN_FINISHED_PLAYER:seat=${state.turnSeat}`);
  }

  if (state.phase === "attacking" && state.turnSeat !== state.attackerSeat) {
    throw new Error("QA_ATTACKER_TURN_DESYNC");
  }
  if (state.phase === "defending" && state.turnSeat !== state.defenderSeat) {
    throw new Error("QA_DEFENDER_TURN_DESYNC");
  }
  if (state.attackerSeat === state.defenderSeat) {
    throw new Error("QA_ATTACKER_EQUALS_DEFENDER");
  }
  if (state.table.length > state.roundAttackLimit && state.roundAttackLimit > 0) {
    throw new Error(
      `QA_ATTACK_LIMIT_EXCEEDED:${state.table.length}/${state.roundAttackLimit}`
    );
  }

  if (state.trumpCard) {
    if (state.trumpCard.kind !== "standard") {
      throw new Error("QA_INVALID_TRUMP_CARD");
    }
    if (!state.trumpSuits.includes(state.trumpCard.suit)) {
      throw new Error("QA_TRUMP_CARD_SUIT_DESYNC");
    }
    if (!unique.has(state.trumpCard.id)) {
      throw new Error("QA_TRUMP_CARD_LOST");
    }
  }
}

export interface QaSimulationResult {
  state: GameState;
  actions: number;
  trace: GameAction[];
}

export function simulateQaMatch(
  settings: GameSettings,
  options: {
    random?: () => number;
    maxActions?: number;
    id?: string;
    style?: QaBotStyle;
    assertInvariants?: boolean;
  } = {}
): QaSimulationResult {
  const random = options.random ?? Math.random;
  const maxActions = options.maxActions ?? 2500;
  const style = options.style ?? "balanced";
  const trace: GameAction[] = [];
  let state = createGame(
    Array.from({ length: settings.playerCount }, (_, index) => `qa:${index}`),
    settings,
    { id: options.id ?? "qa-simulation", random }
  );

  if (options.assertInvariants !== false) assertQaStateInvariants(state);

  for (let actions = 0; actions < maxActions; actions += 1) {
    if (state.phase === "finished") return { state, actions, trace };

    const seat = state.turnSeat;
    if (seat === undefined) {
      throw new Error(`QA_NO_TURN_SEAT:${state.phase}`);
    }

    const action = chooseQaBotAction(state, seat, random, style);
    if (!action) {
      throw new Error(
        `QA_NO_LEGAL_ACTION:${state.phase}:seat=${seat}:trace=${JSON.stringify(trace.slice(-20))}`
      );
    }

    trace.push(action);
    state = applyGameAction(state, action);

    if (options.assertInvariants !== false) {
      try {
        assertQaStateInvariants(state);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${reason}:action=${JSON.stringify(action)}:trace=${JSON.stringify(trace.slice(-20))}`
        );
      }
    }
  }

  throw new Error(
    `QA_ACTION_LIMIT:${maxActions}:phase=${state.phase}:turn=${state.turnSeat}:trace=${JSON.stringify(trace.slice(-20))}`
  );
}
