import { addRpgStartingBonus, assignUniqueClasses, chooseTrumpForMaster, drawTargetForPlayer, refillPlayerHand } from "./classes.js";
import { createDeck, RANK_VALUE, shuffle } from "./deck.js";
import {
  attackLimitForPlayer,
  canBeat,
  getThrowInOrder,
  nextActiveSeat,
  validateTransfer
} from "./rules.js";
import type {
  Card,
  GameAction,
  GameSettings,
  GameState,
  PlayerState,
  Rank,
  StandardCard,
  Suit
} from "./types.js";

export interface CreateGameOptions {
  id?: string;
  random?: () => number;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    settings: { ...state.settings },
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
      ability: { ...player.ability }
    })),
    deck: [...state.deck],
    discard: [...state.discard],
    trumpSuits: [...state.trumpSuits],
    table: state.table.map((pair) => ({ ...pair })),
    throwInPassedSeats: [...state.throwInPassedSeats]
  };
}

function playerBySeat(state: GameState, seat: number): PlayerState {
  const player = state.players.find((entry) => entry.seat === seat);
  if (!player) throw new Error("PLAYER_NOT_FOUND");
  return player;
}

function removeCard(player: PlayerState, cardId: string): Card {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error("CARD_NOT_IN_HAND");
  const [card] = player.hand.splice(index, 1);
  return card;
}

function tableRanks(state: GameState): Set<Rank> {
  const ranks = new Set<Rank>();
  for (const pair of state.table) {
    if (pair.attack.kind === "standard") ranks.add(pair.attack.rank);
    if (pair.defense?.kind === "standard") ranks.add(pair.defense.rank);
  }
  return ranks;
}

function canThrowCard(state: GameState, card: Card): boolean {
  return card.kind === "standard" && tableRanks(state).has(card.rank);
}

function hasThrowableCard(state: GameState, seat: number): boolean {
  return playerBySeat(state, seat).hand.some((card) => canThrowCard(state, card));
}

function lowestTrumpSeat(state: GameState): number {
  const suit = state.trumpSuits[0];
  if (!suit) return state.players.find((player) => !player.finished)?.seat ?? 0;

  let best: { seat: number; value: number } | undefined;
  for (const player of state.players) {
    if (player.finished) continue;
    for (const card of player.hand) {
      if (card.kind !== "standard" || card.suit !== suit) continue;
      const value = RANK_VALUE[card.rank];
      if (!best || value < best.value) best = { seat: player.seat, value };
    }
  }

  return best?.seat ?? state.players.find((player) => !player.finished)?.seat ?? 0;
}

function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((player) => !player.finished);
}

function finishIfComplete(state: GameState): boolean {
  const active = activePlayers(state);
  if (active.length > 1) return false;

  state.phase = "finished";
  state.turnSeat = undefined;
  state.table = [];
  state.roundAttackLimit = 0;
  state.throwInPassedSeats = [];
  state.defenderTaking = false;
  state.draw = active.length === 0;
  state.loserSeat = active.length === 1 ? active[0].seat : undefined;
  return true;
}

function startRound(state: GameState, attackerSeat: number): GameState {
  if (finishIfComplete(state)) return state;

  let attacker = playerBySeat(state, attackerSeat);
  if (attacker.finished) {
    const next = nextActiveSeat(state, attackerSeat, state.direction);
    if (next === undefined) {
      finishIfComplete(state);
      return state;
    }
    attacker = playerBySeat(state, next);
  }

  const defenderSeat = nextActiveSeat(state, attacker.seat, state.direction);
  if (defenderSeat === undefined) {
    finishIfComplete(state);
    return state;
  }

  state.attackerSeat = attacker.seat;
  state.defenderSeat = defenderSeat;
  state.turnSeat = attacker.seat;
  state.phase = "attacking";
  state.table = [];
  state.throwInPassedSeats = [];
  state.defenderTaking = false;
  state.roundAttackLimit = attackLimitForPlayer(state, defenderSeat);
  return state;
}

function markFinishedPlayers(state: GameState): void {
  if (state.deck.length > 0) return;

  let nextPlace =
    state.players.reduce((max, player) => Math.max(max, player.place ?? 0), 0) + 1;

  for (const player of state.players) {
    if (!player.finished && player.hand.length === 0) {
      player.finished = true;
      player.place = nextPlace;
      nextPlace += 1;
    }
  }
}

function orderedSeatsFrom(state: GameState, startSeat: number): number[] {
  const seats: number[] = [];
  let cursor = startSeat;

  for (let i = 0; i < state.players.length; i += 1) {
    if (!seats.includes(cursor)) seats.push(cursor);
    cursor = ((cursor + state.direction) % state.players.length + state.players.length) % state.players.length;
  }

  return seats;
}

function refillInOrder(state: GameState, excludedSeat?: number): void {
  const order = orderedSeatsFrom(state, state.attackerSeat).filter(
    (seat) => seat !== state.defenderSeat && seat !== excludedSeat
  );

  if (excludedSeat !== state.defenderSeat) {
    order.push(state.defenderSeat);
  }

  for (const seat of order) {
    const index = state.players.findIndex((player) => player.seat === seat);
    if (index < 0 || state.players[index].finished) continue;

    const result = refillPlayerHand(
      state.players[index],
      state.deck,
      state.settings.handSize
    );
    state.players[index] = result.player;
    state.deck = result.deck;
  }
}

function collectTableCards(state: GameState): Card[] {
  const cards: Card[] = [];
  for (const pair of state.table) {
    cards.push(pair.attack);
    if (pair.defense) cards.push(pair.defense);
  }
  return cards;
}

function settleSuccessfulDefense(state: GameState): GameState {
  const oldDefenderSeat = state.defenderSeat;
  state.lastRoundOutcome = "discard";
  state.discard.push(...collectTableCards(state));
  state.table = [];

  refillInOrder(state);
  markFinishedPlayers(state);
  if (finishIfComplete(state)) return state;

  const defender = playerBySeat(state, oldDefenderSeat);
  const nextAttacker = defender.finished
    ? nextActiveSeat(state, oldDefenderSeat, state.direction)
    : oldDefenderSeat;

  if (nextAttacker === undefined) {
    finishIfComplete(state);
    return state;
  }

  return startRound(state, nextAttacker);
}

function settleTake(state: GameState): GameState {
  const oldDefenderSeat = state.defenderSeat;
  const defender = playerBySeat(state, oldDefenderSeat);
  state.lastRoundOutcome = "take";
  const collected = collectTableCards(state);
  defender.hand.push(...collected);
  if (collected.some((card) => card.kind === "joker")) {
    defender.ability.jokerAvailable = true;
  }
  state.table = [];

  refillInOrder(state, oldDefenderSeat);
  markFinishedPlayers(state);
  if (finishIfComplete(state)) return state;

  const nextAttacker = nextActiveSeat(state, oldDefenderSeat, state.direction);
  if (nextAttacker === undefined) {
    finishIfComplete(state);
    return state;
  }

  return startRound(state, nextAttacker);
}

function findNextThrower(state: GameState, afterSeat?: number): number | undefined {
  const order = getThrowInOrder(state).filter(
    (seat) =>
      !state.throwInPassedSeats.includes(seat) &&
      hasThrowableCard(state, seat)
  );
  if (order.length === 0) return undefined;
  if (afterSeat === undefined) return order[0];

  const fullOrder = getThrowInOrder(state);
  const startIndex = fullOrder.indexOf(afterSeat);

  for (let offset = 1; offset <= fullOrder.length; offset += 1) {
    const candidate = fullOrder[(startIndex + offset + fullOrder.length) % fullOrder.length];
    if (order.includes(candidate)) return candidate;
  }

  return order[0];
}

function enterThrowing(state: GameState, afterSeat?: number): GameState {
  if (state.table.length >= state.roundAttackLimit) {
    return state.defenderTaking ? settleTake(state) : settleSuccessfulDefense(state);
  }

  const next = findNextThrower(state, afterSeat);
  if (next === undefined) {
    return state.defenderTaking ? settleTake(state) : settleSuccessfulDefense(state);
  }

  state.phase = "throwing";
  state.turnSeat = next;
  return state;
}

function initializePlayers(
  playerIds: string[],
  settings: GameSettings,
  random: () => number
): PlayerState[] {
  const classes =
    settings.mode === "rpg" ? assignUniqueClasses(playerIds, random) : {};

  return playerIds.map((id, seat) => {
    const classId = classes[id];
    return {
      id,
      seat,
      classId,
      hand: [],
      ability: {
        wildTransfersLeft: classId === "wild-transfer" ? 2 : 0,
        jokerAvailable: false
      },
      finished: false
    };
  });
}

function dealInitialHands(
  players: PlayerState[],
  deck: StandardCard[],
  handSize: number
): StandardCard[] {
  const nextDeck = [...deck];
  let dealtAny = true;

  while (dealtAny) {
    dealtAny = false;

    for (const player of players) {
      const target = drawTargetForPlayer(player, handSize);
      if (player.hand.length >= target || nextDeck.length === 0) continue;
      player.hand.push(nextDeck.shift()!);
      dealtAny = true;
    }
  }

  return nextDeck;
}

export function createGame(
  playerIds: string[],
  settings: GameSettings,
  options: CreateGameOptions = {}
): GameState {
  if (playerIds.length !== settings.playerCount) {
    throw new Error("PLAYER_COUNT_MISMATCH");
  }
  if (playerIds.length < 2 || playerIds.length > 6) {
    throw new Error("PLAYER_COUNT_OUT_OF_RANGE");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("DUPLICATE_PLAYER");
  }

  const random = options.random ?? Math.random;
  const shuffled = shuffle(createDeck(), random);
  const naturalTrumpCard = shuffled.at(-1);
  let players = initializePlayers(playerIds, settings, random);
  const deck = dealInitialHands(players, shuffled, settings.handSize);

  if (settings.mode === "rpg") {
    players = players.map(addRpgStartingBonus);
  }

  const trumpMaster = players.find((player) => player.classId === "trump-master");
  const awaitingTrump = settings.mode === "rpg" && trumpMaster !== undefined;

  const state: GameState = {
    id: options.id ?? "game",
    settings: { ...settings },
    phase: awaitingTrump ? "awaiting-trump" : "attacking",
    players,
    deck,
    discard: [],
    trumpSuits: awaitingTrump || !naturalTrumpCard ? [] : [naturalTrumpCard.suit],
    trumpCard: awaitingTrump ? undefined : naturalTrumpCard,
    table: [],
    attackerSeat: 0,
    defenderSeat: 1,
    turnSeat: awaitingTrump ? trumpMaster?.seat : 0,
    direction: 1,
    roundAttackLimit: 0,
    throwInPassedSeats: [],
    defenderTaking: false,
    draw: false
  };

  if (awaitingTrump) return state;

  return startRound(state, lowestTrumpSeat(state));
}

function chooseTrump(state: GameState, playerSeat: number, suit: Suit): GameState {
  if (state.phase !== "awaiting-trump" || state.turnSeat !== playerSeat) {
    throw new Error("NOT_WAITING_FOR_TRUMP");
  }

  const next = chooseTrumpForMaster(state, playerSeat, suit);
  next.phase = "attacking";
  next.turnSeat = undefined;
  return startRound(next, lowestTrumpSeat(next));
}

function playAttack(state: GameState, playerSeat: number, cardId: string): GameState {
  if (state.phase !== "attacking" && state.phase !== "throwing") {
    throw new Error("ATTACK_NOT_ALLOWED");
  }
  if (state.turnSeat !== playerSeat) throw new Error("NOT_YOUR_TURN");

  const next = cloneState(state);
  const player = playerBySeat(next, playerSeat);
  const card = removeCard(player, cardId);

  if (card.kind !== "standard") throw new Error("JOKER_DEFENSE_ONLY");

  if (next.phase === "attacking") {
    if (next.table.length !== 0 || playerSeat !== next.attackerSeat) {
      throw new Error("INVALID_INITIAL_ATTACK");
    }

    next.table.push({ attack: card });
    next.phase = "defending";
    next.turnSeat = next.defenderSeat;
    return next;
  }

  if (!canThrowCard(next, card)) throw new Error("THROW_IN_RANK_MISMATCH");
  if (next.table.length >= next.roundAttackLimit) throw new Error("ATTACK_LIMIT_REACHED");

  next.table.push({ attack: card });

  if (next.defenderTaking) {
    if (next.table.length >= next.roundAttackLimit) return settleTake(next);
    return enterThrowing(next, playerSeat);
  }

  next.phase = "defending";
  next.turnSeat = next.defenderSeat;
  return next;
}

function playDefense(
  state: GameState,
  playerSeat: number,
  attackCardId: string,
  cardId: string
): GameState {
  if (state.phase !== "defending") throw new Error("DEFENSE_NOT_ALLOWED");
  if (state.turnSeat !== playerSeat || playerSeat !== state.defenderSeat) {
    throw new Error("NOT_YOUR_TURN");
  }

  const next = cloneState(state);
  const player = playerBySeat(next, playerSeat);
  const pair = next.table.find(
    (entry) => entry.attack.id === attackCardId && !entry.defense
  );
  if (!pair) throw new Error("ATTACK_CARD_NOT_OPEN");

  const defense = removeCard(player, cardId);
  if (!canBeat(pair.attack, defense, next.trumpSuits)) {
    throw new Error("CARD_CANNOT_BEAT");
  }

  pair.defense = defense;
  if (defense.kind === "joker") {
    player.ability.jokerAvailable = false;
  }

  if (next.table.some((entry) => !entry.defense)) {
    next.turnSeat = next.defenderSeat;
    return next;
  }

  next.throwInPassedSeats = [];
  return enterThrowing(next);
}

function transfer(
  state: GameState,
  playerSeat: number,
  cardId: string,
  reverse = false
): GameState {
  if (state.phase !== "defending") throw new Error("TRANSFER_NOT_ALLOWED");
  if (state.turnSeat !== playerSeat || state.defenderSeat !== playerSeat) {
    throw new Error("NOT_YOUR_TURN");
  }

  const next = cloneState(state);
  const player = playerBySeat(next, playerSeat);
  const card = player.hand.find((entry) => entry.id === cardId);
  if (!card) throw new Error("CARD_NOT_IN_HAND");

  const validation = validateTransfer(next, {
    playerSeat,
    card,
    reverse
  });
  if (!validation.ok || validation.nextDefenderSeat === undefined || validation.nextDirection === undefined) {
    throw new Error(validation.reason ?? "TRANSFER_NOT_ALLOWED");
  }

  removeCard(player, cardId);
  next.table.push({ attack: card });

  if (validation.consumesWildTransfer) {
    player.ability.wildTransfersLeft -= 1;
  }

  next.direction = validation.nextDirection;
  next.attackerSeat = playerSeat;
  next.defenderSeat = validation.nextDefenderSeat;
  next.turnSeat = validation.nextDefenderSeat;
  next.roundAttackLimit = attackLimitForPlayer(next, validation.nextDefenderSeat);
  next.throwInPassedSeats = [];
  next.defenderTaking = false;
  next.phase = "defending";
  return next;
}

function take(state: GameState, playerSeat: number): GameState {
  if (state.phase !== "defending") throw new Error("TAKE_NOT_ALLOWED");
  if (state.turnSeat !== playerSeat || state.defenderSeat !== playerSeat) {
    throw new Error("NOT_YOUR_TURN");
  }

  const next = cloneState(state);
  next.defenderTaking = true;
  next.throwInPassedSeats = [];
  return enterThrowing(next);
}

function passThrowIn(state: GameState, playerSeat: number): GameState {
  if (state.phase !== "throwing") throw new Error("PASS_NOT_ALLOWED");
  if (state.turnSeat !== playerSeat) throw new Error("NOT_YOUR_TURN");

  const next = cloneState(state);
  if (!next.throwInPassedSeats.includes(playerSeat)) {
    next.throwInPassedSeats.push(playerSeat);
  }

  return enterThrowing(next, playerSeat);
}

export function applyGameAction(state: GameState, action: GameAction): GameState {
  if (state.phase === "finished") throw new Error("GAME_FINISHED");

  switch (action.type) {
    case "choose_trump":
      return chooseTrump(cloneState(state), action.playerSeat, action.suit);
    case "attack":
      return playAttack(state, action.playerSeat, action.cardId);
    case "defend":
      return playDefense(state, action.playerSeat, action.attackCardId, action.cardId);
    case "transfer":
      return transfer(state, action.playerSeat, action.cardId, action.reverse);
    case "take":
      return take(state, action.playerSeat);
    case "pass_throw_in":
      return passThrowIn(state, action.playerSeat);
  }
}
