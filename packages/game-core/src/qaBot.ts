import { applyGameAction, createGame } from "./engine.js";
import type {
  Card,
  GameAction,
  GameSettings,
  GameState,
  StandardCard,
  Suit
} from "./types.js";

const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];

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

export function chooseQaBotAction(
  state: GameState,
  playerSeat: number,
  random: () => number = Math.random
): GameAction | undefined {
  const legal = enumerateLegalActions(state, playerSeat);
  if (legal.length === 0) return undefined;

  const trump = legal.filter(
    (action): action is Extract<GameAction, { type: "choose_trump" }> =>
      action.type === "choose_trump"
  );
  if (trump.length > 0) return chooseTrump(state, trump);

  if (state.phase === "attacking") {
    const attacks = legal.filter(
      (action): action is Extract<GameAction, { type: "attack" }> =>
        action.type === "attack"
    );
    return attacks.length > 0 ? lowestCardAction(state, attacks) : legal[0];
  }

  if (state.phase === "defending") {
    const defenses = legal.filter(
      (action): action is Extract<GameAction, { type: "defend" }> =>
        action.type === "defend"
    );
    const transfers = legal.filter(
      (action): action is Extract<GameAction, { type: "transfer" }> =>
        action.type === "transfer"
    );

    // Exercise transfer mechanics often enough for QA, but normally prefer
    // a cheap defense so simulations still converge quickly.
    if (transfers.length > 0 && random() < 0.28) {
      const reverse = transfers.filter((action) => action.reverse === true);
      const pool = reverse.length > 0 && random() < 0.35 ? reverse : transfers;
      return lowestCardAction(state, pool);
    }
    if (defenses.length > 0) return lowestCardAction(state, defenses);
    if (transfers.length > 0) return lowestCardAction(state, transfers);

    return legal.find((action) => action.type === "take") ?? legal[0];
  }

  if (state.phase === "throwing") {
    const attacks = legal.filter(
      (action): action is Extract<GameAction, { type: "attack" }> =>
        action.type === "attack"
    );
    const pass = legal.find((action) => action.type === "pass_throw_in");

    if (attacks.length > 0 && (!pass || random() < 0.58)) {
      return lowestCardAction(state, attacks);
    }
    return pass ?? legal[0];
  }

  return legal[0];
}

export interface QaSimulationResult {
  state: GameState;
  actions: number;
}

export function simulateQaMatch(
  settings: GameSettings,
  options: {
    random?: () => number;
    maxActions?: number;
    id?: string;
  } = {}
): QaSimulationResult {
  const random = options.random ?? Math.random;
  const maxActions = options.maxActions ?? 2500;
  let state = createGame(
    Array.from({ length: settings.playerCount }, (_, index) => `qa:${index}`),
    settings,
    { id: options.id ?? "qa-simulation", random }
  );

  for (let actions = 0; actions < maxActions; actions += 1) {
    if (state.phase === "finished") return { state, actions };

    const seat = state.turnSeat;
    if (seat === undefined) {
      throw new Error(`QA_NO_TURN_SEAT:${state.phase}`);
    }

    const action = chooseQaBotAction(state, seat, random);
    if (!action) {
      throw new Error(`QA_NO_LEGAL_ACTION:${state.phase}:seat=${seat}`);
    }

    state = applyGameAction(state, action);
  }

  throw new Error(
    `QA_ACTION_LIMIT:${maxActions}:phase=${state.phase}:turn=${state.turnSeat}`
  );
}
