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
}

export const DEFAULT_RATING = 1000;
export const RATING_K = 32;

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

function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
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

  const perOpponentK = RATING_K / winners.length;
  let loserDelta = 0;
  const winnerDeltas = new Map<string, number>();

  for (const winner of winners) {
    const expectedWinner = expectedScore(winner.rating, loser.rating);
    const delta = perOpponentK * (1 - expectedWinner);
    winnerDeltas.set(winner.playerId, delta);
    loserDelta -= delta;
  }

  return profiles.map((profile) => {
    if (profile.playerId === loser.playerId) {
      const xp = profile.xp + 40;
      return {
        ...profile,
        rating: oneDecimal(Math.max(100, profile.rating + loserDelta)),
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
      rating: oneDecimal(profile.rating + (winnerDeltas.get(profile.playerId) ?? 0)),
      games: profile.games + 1,
      wins: profile.wins + 1,
      currentStreak: streak,
      bestStreak: Math.max(profile.bestStreak, streak),
      xp,
      level: levelFromXp(xp)
    };
  });
}
