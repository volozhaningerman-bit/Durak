import { RANK_VALUE } from "./deck.js";
import type {
  Card,
  GameSettings,
  GameState,
  StandardCard,
  Suit,
  TransferIntent,
  TransferValidation
} from "./types.js";

export const DEFAULT_CLASSIC_SETTINGS: GameSettings = {
  mode: "classic",
  playerCount: 2,
  variant: "throw-in",
  throwInPolicy: "all",
  handSize: 6,
  ranked: false,
  gameplayItemsEnabled: false
};

export const DEFAULT_RPG_SETTINGS: GameSettings = {
  mode: "rpg",
  playerCount: 2,
  variant: "transfer",
  throwInPolicy: "all",
  handSize: 6,
  ranked: false,
  gameplayItemsEnabled: true
};

function isStandard(card: Card): card is StandardCard {
  return card.kind === "standard";
}

function normalizeSeat(state: GameState, seat: number): number {
  const count = state.players.length;
  return ((seat % count) + count) % count;
}

export function attackLimitForPlayer(state: GameState, playerSeat: number): number {
  const defender = state.players.find((p) => p.seat === playerSeat);
  if (!defender) return 0;

  const classLimit =
    state.settings.mode === "rpg" && defender.classId === "five-limit" ? 5 : 6;

  return Math.min(classLimit, defender.hand.length);
}

export function canBeat(
  attack: Card,
  defense: Card,
  trumpSuits: readonly Suit[]
): boolean {
  if (defense.kind === "joker") return true;
  if (attack.kind === "joker") return false;
  if (!isStandard(attack) || !isStandard(defense)) return false;

  const defenseTrump = trumpSuits.includes(defense.suit);
  const attackTrump = trumpSuits.includes(attack.suit);

  if (defense.suit === attack.suit) {
    return RANK_VALUE[defense.rank] > RANK_VALUE[attack.rank];
  }

  return defenseTrump && !attackTrump;
}

export function nextActiveSeat(
  state: GameState,
  fromSeat: number,
  direction: 1 | -1
): number | undefined {
  for (let step = 1; step < state.players.length; step += 1) {
    const candidate = normalizeSeat(state, fromSeat + step * direction);
    const player = state.players.find((p) => p.seat === candidate);
    if (player && !player.finished) return candidate;
  }
  return undefined;
}

export function validateTransfer(
  state: GameState,
  intent: TransferIntent
): TransferValidation {
  const player = state.players.find((p) => p.seat === intent.playerSeat);
  if (!player) return { ok: false, consumesWildTransfer: false, reason: "PLAYER_NOT_FOUND" };
  if (state.settings.variant !== "transfer") {
    return { ok: false, consumesWildTransfer: false, reason: "TRANSFER_DISABLED" };
  }
  if (intent.playerSeat !== state.defenderSeat) {
    return { ok: false, consumesWildTransfer: false, reason: "NOT_DEFENDER" };
  }
  if (state.table.some((pair) => pair.defense)) {
    return { ok: false, consumesWildTransfer: false, reason: "ALREADY_DEFENDED" };
  }

  const attackRanks = state.table
    .map((pair) => pair.attack)
    .filter(isStandard)
    .map((card) => card.rank);

  const transferRank = intent.card.kind === "standard" ? intent.card.rank : undefined;
  const standardTransfer =
    transferRank !== undefined &&
    attackRanks.length > 0 &&
    attackRanks.every((rank) => rank === transferRank);

  const canUseWild =
    state.settings.mode === "rpg" &&
    player.classId === "wild-transfer" &&
    player.ability.wildTransfersLeft > 0 &&
    intent.card.kind === "standard";

  if (!standardTransfer && !canUseWild) {
    return { ok: false, consumesWildTransfer: false, reason: "RANK_MISMATCH" };
  }

  const reverse =
    Boolean(intent.reverse) &&
    state.settings.mode === "rpg" &&
    player.classId === "reverse-transfer";

  const nextDirection: 1 | -1 = reverse
    ? (state.direction === 1 ? -1 : 1)
    : state.direction;

  const nextDefenderSeat = nextActiveSeat(
    state,
    intent.playerSeat,
    nextDirection
  );

  if (nextDefenderSeat === undefined) {
    return { ok: false, consumesWildTransfer: false, reason: "NO_NEXT_DEFENDER" };
  }

  const resultingAttackCount = state.table.length + 1;
  const targetLimit = attackLimitForPlayer(state, nextDefenderSeat);
  if (resultingAttackCount > targetLimit) {
    return {
      ok: false,
      consumesWildTransfer: false,
      reason: "NEXT_PLAYER_NOT_ENOUGH_CARDS"
    };
  }

  return {
    ok: true,
    consumesWildTransfer: !standardTransfer && canUseWild,
    nextDefenderSeat,
    nextDirection
  };
}

export function maxAttackCardsForDefender(state: GameState): number {
  if (state.roundAttackLimit > 0) return state.roundAttackLimit;
  return attackLimitForPlayer(state, state.defenderSeat);
}

export function getThrowInOrder(state: GameState): number[] {
  const activeSeats = state.players
    .filter((player) => !player.finished && player.seat !== state.defenderSeat)
    .map((player) => player.seat);

  if (activeSeats.length === 0) return [];

  const priorityPlayer = state.players.find(
    (player) =>
      !player.finished &&
      player.seat !== state.defenderSeat &&
      player.classId === "first-thrower"
  );

  const ordered: number[] = [];
  const pushUnique = (seat: number | undefined) => {
    if (seat === undefined) return;
    if (!activeSeats.includes(seat)) return;
    if (!ordered.includes(seat)) ordered.push(seat);
  };

  pushUnique(priorityPlayer?.seat);
  pushUnique(state.attackerSeat);

  let cursor = state.attackerSeat;
  for (let i = 0; i < state.players.length; i += 1) {
    cursor = normalizeSeat(state, cursor + state.direction);
    pushUnique(cursor);
  }

  if (state.settings.throwInPolicy === "all") {
    return ordered;
  }

  const previousOfDefender = normalizeSeat(
    state,
    state.defenderSeat - state.direction
  );
  const nextOfDefender = normalizeSeat(
    state,
    state.defenderSeat + state.direction
  );

  return ordered.filter(
    (seat) =>
      seat === priorityPlayer?.seat ||
      seat === state.attackerSeat ||
      seat === previousOfDefender ||
      seat === nextOfDefender
  );
}
