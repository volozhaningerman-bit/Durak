import { Pool, type PoolClient } from "pg";
import {
  applyMatchProgress,
  createPlayerProgress,
  type PlayerProgress
} from "@durak/game-core";

export interface ProfileStore {
  init(): Promise<void>;
  getProfile(playerId: string): Promise<PlayerProgress>;
  recordMatch(
    matchId: string,
    playerIds: string[],
    loserId: string | undefined,
    draw: boolean
  ): Promise<PlayerProgress[]>;
  close(): Promise<void>;
}

export class MemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, PlayerProgress>();
  private readonly processedMatches = new Set<string>();

  async init(): Promise<void> {}

  async getProfile(playerId: string): Promise<PlayerProgress> {
    const profile = this.profiles.get(playerId) ?? createPlayerProgress(playerId);
    this.profiles.set(playerId, profile);
    return { ...profile };
  }

  async recordMatch(
    matchId: string,
    playerIds: string[],
    loserId: string | undefined,
    draw: boolean
  ): Promise<PlayerProgress[]> {
    if (this.processedMatches.has(matchId)) {
      return Promise.all(playerIds.map((id) => this.getProfile(id)));
    }

    const current = await Promise.all(playerIds.map((id) => this.getProfile(id)));
    const updated = applyMatchProgress(current, { playerIds, loserId, draw });

    for (const profile of updated) {
      this.profiles.set(profile.playerId, { ...profile });
    }
    this.processedMatches.add(matchId);
    return updated.map((profile) => ({ ...profile }));
  }

  async close(): Promise<void> {}
}

function rowToProfile(row: Record<string, unknown>): PlayerProgress {
  return {
    playerId: String(row.player_id),
    rating: Number(row.rating),
    games: Number(row.games),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
    currentStreak: Number(row.current_streak),
    bestStreak: Number(row.best_streak),
    xp: Number(row.xp),
    level: Number(row.level)
  };
}

export class PostgresProfileStore implements ProfileStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS player_profiles (
        player_id TEXT PRIMARY KEY,
        rating NUMERIC(8,1) NOT NULL DEFAULT 1000,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS match_results (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL REFERENCES player_profiles(player_id) ON DELETE CASCADE,
        result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
        rating_before NUMERIC(8,1) NOT NULL,
        rating_after NUMERIC(8,1) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (match_id, player_id)
      );

      CREATE INDEX IF NOT EXISTS match_results_player_created_idx
        ON match_results(player_id, created_at DESC);
    `);
  }

  private async ensureProfile(client: PoolClient, playerId: string): Promise<void> {
    await client.query(
      `INSERT INTO player_profiles (player_id) VALUES ($1)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId]
    );
  }

  async getProfile(playerId: string): Promise<PlayerProgress> {
    const client = await this.pool.connect();
    try {
      await this.ensureProfile(client, playerId);
      const result = await client.query(
        `SELECT * FROM player_profiles WHERE player_id = $1`,
        [playerId]
      );
      return rowToProfile(result.rows[0] as Record<string, unknown>);
    } finally {
      client.release();
    }
  }

  async recordMatch(
    matchId: string,
    playerIds: string[],
    loserId: string | undefined,
    draw: boolean
  ): Promise<PlayerProgress[]> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const alreadyProcessed = await client.query(
        `SELECT 1 FROM match_results WHERE match_id = $1 LIMIT 1`,
        [matchId]
      );

      if (alreadyProcessed.rowCount && alreadyProcessed.rowCount > 0) {
        const existing = await this.loadProfiles(client, playerIds);
        await client.query("COMMIT");
        return existing;
      }

      for (const playerId of playerIds) {
        await this.ensureProfile(client, playerId);
      }

      const current = await this.loadProfiles(client, playerIds, true);
      const updated = applyMatchProgress(current, { playerIds, loserId, draw });
      const before = new Map(current.map((profile) => [profile.playerId, profile]));

      for (const profile of updated) {
        await client.query(
          `UPDATE player_profiles
             SET rating = $2,
                 games = $3,
                 wins = $4,
                 losses = $5,
                 draws = $6,
                 current_streak = $7,
                 best_streak = $8,
                 xp = $9,
                 level = $10,
                 updated_at = NOW()
           WHERE player_id = $1`,
          [
            profile.playerId,
            profile.rating,
            profile.games,
            profile.wins,
            profile.losses,
            profile.draws,
            profile.currentStreak,
            profile.bestStreak,
            profile.xp,
            profile.level
          ]
        );

        const result = draw
          ? "draw"
          : profile.playerId === loserId
            ? "loss"
            : "win";

        await client.query(
          `INSERT INTO match_results
             (match_id, player_id, result, rating_before, rating_after)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            matchId,
            profile.playerId,
            result,
            before.get(profile.playerId)?.rating ?? 1000,
            profile.rating
          ]
        );
      }

      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadProfiles(
    client: PoolClient,
    playerIds: string[],
    forUpdate = false
  ): Promise<PlayerProgress[]> {
    const result = await client.query(
      `SELECT * FROM player_profiles
       WHERE player_id = ANY($1::text[])
       ${forUpdate ? "FOR UPDATE" : ""}`,
      [playerIds]
    );

    const byId = new Map(
      result.rows.map((row) => {
        const profile = rowToProfile(row as Record<string, unknown>);
        return [profile.playerId, profile] as const;
      })
    );

    return playerIds.map((id) => byId.get(id) ?? createPlayerProgress(id));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createProfileStore(databaseUrl?: string): ProfileStore {
  return databaseUrl
    ? new PostgresProfileStore(databaseUrl)
    : new MemoryProfileStore();
}
