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
  winnerOrder?: string[];
}

export const DEFAULT_RATING = 1000;
export const MIN_RATING = 100;
export const RANKED_RATING_POOL = 30;

export function ratingAwardsForWinnerCount(winnerCount: number): number[] {
  const count = Math.max(1, Math.min(5, Math.round(winnerCount)));
  const weights = Array.from({ length: count }, (_, index) => count - index);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (RANKED_RATING_POOL * weight) / weightSum);
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

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
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

  const orderedWinnerIds = [
    ...(result.winnerOrder ?? []).filter(
      (id) => id !== result.loserId && winners.some((winner) => winner.playerId === id)
    ),
    ...winners
      .map((winner) => winner.playerId)
      .filter((id) => !(result.winnerOrder ?? []).includes(id))
  ];

  const ratingEnabled = result.ranked !== false;
  const requestedLoss = ratingEnabled ? RANKED_RATING_POOL : 0;
  const loserLoss = ratingEnabled
    ? Math.min(requestedLoss, Math.max(0, loser.rating - MIN_RATING))
    : 0;
  const baseAwards = ratingAwardsForWinnerCount(orderedWinnerIds.length);
  const scale = requestedLoss > 0 ? loserLoss / requestedLoss : 0;
  const winnerDeltas = new Map(
    orderedWinnerIds.map((id, index) => [
      id,
      oneDecimal((baseAwards[index] ?? 0) * scale)
    ])
  );

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
        ? oneDecimal(profile.rating + (winnerDeltas.get(profile.playerId) ?? 0))
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
