export interface PlayerProgress {
  playerId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  xp: number;
  level: number;
}

export interface MatchProgressResult {
  playerIds: string[];
  loserId?: string;
  draw: boolean;
  ranked?: boolean;
}

export const DEFAULT_RATING = 1000;
export const MIN_RATING = 100;

const BASE_RATING_POOL: Record<number, number> = {
  2: 20,
  3: 24,
  4: 30,
  5: 32,
  6: 35
};

export function baseRatingChange(playerCount: number): {
  winnerGain: number;
  loserLoss: number;
} {
  const safeCount = Math.max(2, Math.min(6, Math.round(playerCount)));
  const loserLoss = BASE_RATING_POOL[safeCount] ?? 20;
  return {
    loserLoss,
    winnerGain: loserLoss / (safeCount - 1)
  };
}

export function levelFromXp(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / 500);
}

export function createPlayerProgress(playerId: string): PlayerProgress {
  return {
    playerId,
    rating: DEFAULT_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
    xp: 0,
    level: 1
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function rankedPool(
  loser: PlayerProgress,
  winners: readonly PlayerProgress[]
): number {
  const base = baseRatingChange(winners.length + 1).loserLoss;
  const averageWinnerRating =
    winners.reduce((sum, winner) => sum + winner.rating, 0) / winners.length;

  // A favourite who loses pays more; an underdog pays less.
  // The modifier is deliberately capped so rating stays predictable.
  const strengthFactor = clamp(
    1 + (loser.rating - averageWinnerRating) / 1000,
    0.7,
    1.3
  );

  return oneDecimal(base * strengthFactor);
}

export function applyMatchProgress(
  current: readonly PlayerProgress[],
  result: MatchProgressResult
): PlayerProgress[] {
  const byId = new Map(current.map((profile) => [profile.playerId, { ...profile }]));
  const profiles = result.playerIds.map((id) => byId.get(id) ?? createPlayerProgress(id));

  if (result.draw || !result.loserId) {
    return profiles.map((profile) => {
      const xp = profile.xp + 60;
      return {
        ...profile,
        games: profile.games + 1,
        draws: profile.draws + 1,
        currentStreak: 0,
        xp,
        level: levelFromXp(xp)
      };
    });
  }

  const loser = profiles.find((profile) => profile.playerId === result.loserId);
  if (!loser) throw new Error("LOSER_NOT_IN_MATCH");

  const winners = profiles.filter((profile) => profile.playerId !== result.loserId);
  if (winners.length === 0) throw new Error("MATCH_REQUIRES_WINNER");

  const ratingEnabled = result.ranked !== false;
  let winnerGain = 0;
  let loserLoss = 0;

  if (ratingEnabled) {
    const requestedPool = rankedPool(loser, winners);
    const availableLoss = Math.max(0, loser.rating - MIN_RATING);
    const actualPool = Math.min(requestedPool, availableLoss);
    winnerGain = oneDecimal(actualPool / winners.length);
    loserLoss = oneDecimal(winnerGain * winners.length);
  }

  return profiles.map((profile) => {
    if (profile.playerId === loser.playerId) {
      const xp = profile.xp + 40;
      return {
        ...profile,
        rating: ratingEnabled
          ? oneDecimal(Math.max(MIN_RATING, profile.rating - loserLoss))
          : profile.rating,
        games: profile.games + 1,
        losses: profile.losses + 1,
        currentStreak: 0,
        xp,
        level: levelFromXp(xp)
      };
    }

    const streak = profile.currentStreak + 1;
    const xp = profile.xp + 100;
    return {
      ...profile,
      rating: ratingEnabled
        ? oneDecimal(profile.rating + winnerGain)
        : profile.rating,
      games: profile.games + 1,
      wins: profile.wins + 1,
      currentStreak: streak,
      bestStreak: Math.max(profile.bestStreak, streak),
      xp,
      level: levelFromXp(xp)
    };
  });
}
