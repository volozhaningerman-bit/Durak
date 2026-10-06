export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type GameMode = "classic" | "rpg";
export type DurakVariant = "throw-in" | "transfer";
export type ThrowInPolicy = "all" | "neighbors";
export type ThemeId = "light" | "dark";
export type GamePhase =
  | "awaiting-trump"
  | "attacking"
  | "defending"
  | "throwing"
  | "finished";

export type RpgClassId =
  | "trump-master"
  | "wild-transfer"
  | "five-limit"
  | "first-thrower"
  | "reverse-transfer"
  | "joker";

export interface StandardCard {
  id: string;
  kind: "standard";
  suit: Suit;
  rank: Rank;
}

export interface JokerCard {
  id: string;
  kind: "joker";
}

export type Card = StandardCard | JokerCard;

export interface GameSettings {
  mode: GameMode;
  playerCount: 2 | 3 | 4 | 5 | 6;
  variant: DurakVariant;
  throwInPolicy: ThrowInPolicy;
  handSize: number;
  ranked: boolean;
  gameplayItemsEnabled: boolean;
}

export interface PlayerAbilityState {
  wildTransfersLeft: number;
  jokerAvailable: boolean;
}

export interface PlayerState {
  id: string;
  seat: number;
  classId?: RpgClassId;
  hand: Card[];
  ability: PlayerAbilityState;
  finished: boolean;
  place?: number;
}

export interface AttackPair {
  attack: Card;
  defense?: Card;
}

export interface GameState {
  id: string;
  settings: GameSettings;
  phase: GamePhase;
  players: PlayerState[];
  deck: StandardCard[];
  discard: Card[];
  trumpSuits: Suit[];
  trumpCard?: StandardCard;
  table: AttackPair[];
  attackerSeat: number;
  defenderSeat: number;
  turnSeat?: number;
  direction: 1 | -1;
  roundAttackLimit: number;
  throwInPassedSeats: number[];
  defenderTaking: boolean;
  loserSeat?: number;
  draw: boolean;
}

export interface TransferIntent {
  playerSeat: number;
  card: Card;
  reverse?: boolean;
}

export interface TransferValidation {
  ok: boolean;
  consumesWildTransfer: boolean;
  nextDefenderSeat?: number;
  nextDirection?: 1 | -1;
  reason?: string;
}

export type GameAction =
  | { type: "choose_trump"; playerSeat: number; suit: Suit }
  | { type: "attack"; playerSeat: number; cardId: string }
  | { type: "defend"; playerSeat: number; attackCardId: string; cardId: string }
  | { type: "transfer"; playerSeat: number; cardId: string; reverse?: boolean }
  | { type: "take"; playerSeat: number }
  | { type: "pass_throw_in"; playerSeat: number };
