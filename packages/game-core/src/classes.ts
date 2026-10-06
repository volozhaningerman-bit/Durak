import type {
  Card,
  GameState,
  PlayerState,
  RpgClassId,
  StandardCard,
  Suit
} from "./types.js";
import { shuffle } from "./deck.js";

export const RPG_CLASSES: RpgClassId[] = [
  "trump-master",
  "wild-transfer",
  "five-limit",
  "first-thrower",
  "reverse-transfer",
  "joker"
];

export const RPG_CLASS_NAMES: Record<RpgClassId, string> = {
  "trump-master": "Козырник",
  "wild-transfer": "Переводчик",
  "five-limit": "Пятёрочник",
  "first-thrower": "Подкидчик",
  "reverse-transfer": "Реверс",
  joker: "Джокер"
};

export function assignUniqueClasses(
  playerIds: string[],
  random = Math.random
): Record<string, RpgClassId> {
  if (playerIds.length > RPG_CLASSES.length) {
    throw new Error("RPG mode supports at most 6 unique classes");
  }

  const classes = shuffle(RPG_CLASSES, random).slice(0, playerIds.length);
  return Object.fromEntries(playerIds.map((id, index) => [id, classes[index]]));
}

export function chooseTrumpForMaster(
  state: GameState,
  playerSeat: number,
  suit: Suit
): GameState {
  const player = state.players.find((entry) => entry.seat === playerSeat);
  if (state.settings.mode !== "rpg" || player?.classId !== "trump-master") {
    throw new Error("PLAYER_CANNOT_CHOOSE_TRUMP");
  }

  const index = state.deck.findIndex((card) => card.suit === suit);
  if (index === -1) {
    throw new Error("CHOSEN_TRUMP_SUIT_NOT_IN_DECK");
  }

  const deck = [...state.deck];
  const [trumpCard] = deck.splice(index, 1);
  deck.push(trumpCard);

  return {
    ...state,
    deck,
    trumpSuits: [suit],
    trumpCard
  };
}

export function addRpgStartingBonus(player: PlayerState): PlayerState {
  if (player.classId !== "joker") return player;

  const joker: Card = { id: `joker-${player.id}`, kind: "joker" };
  return {
    ...player,
    hand: [...player.hand, joker],
    ability: {
      ...player.ability,
      jokerAvailable: true
    }
  };
}

export function drawTargetForPlayer(player: PlayerState, defaultHandSize = 6): number {
  return player.classId === "five-limit" ? 5 : defaultHandSize;
}

export function refillPlayerHand(
  player: PlayerState,
  deck: readonly StandardCard[],
  defaultHandSize = 6
): { player: PlayerState; deck: StandardCard[] } {
  const nextDeck = [...deck];
  const hand = [...player.hand];
  const target = drawTargetForPlayer(player, defaultHandSize);

  while (hand.length < target && nextDeck.length > 0) {
    hand.push(nextDeck.shift()!);
  }

  return {
    player: { ...player, hand },
    deck: nextDeck
  };
}
