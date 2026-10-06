import type { RpgClassId } from "./types.js";
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
