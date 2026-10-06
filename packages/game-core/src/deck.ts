import type { Rank, StandardCard, Suit } from "./types.js";

export const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const RANKS: Rank[] = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export const RANK_VALUE: Record<Rank, number> = {
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

export function createDeck(): StandardCard[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${suit}-${rank}`,
      kind: "standard" as const,
      suit,
      rank
    }))
  );
}

export function shuffle<T>(input: readonly T[], random = Math.random): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
