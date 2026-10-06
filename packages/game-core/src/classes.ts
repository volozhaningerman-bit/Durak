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

  const players = state.players.map((entry) => ({
    ...entry,
    hand: [...entry.hand],
    ability: { ...entry.ability }
  }));
  const deck = [...state.deck];

  let trumpCard: StandardCard | undefined;
  const deckIndex = deck.findIndex((card) => card.suit === suit);

  if (deckIndex >= 0) {
    [trumpCard] = deck.splice(deckIndex, 1);
    deck.push(trumpCard);
  } else if (deck.length > 0) {
    for (const owner of players) {
      const handIndex = owner.hand.findIndex(
        (card): card is StandardCard => card.kind === "standard" && card.suit === suit
      );
      if (handIndex < 0) continue;

      const chosen = owner.hand[handIndex] as StandardCard;
      const replacement = deck.pop()!;
      owner.hand.splice(handIndex, 1, replacement);
      deck.push(chosen);
      trumpCard = chosen;
      break;
    }
  }

  if (!trumpCard) {
    throw new Error("CHOSEN_TRUMP_SUIT_UNAVAILABLE");
  }

  return {
    ...state,
    players,
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
