import "dotenv/config";
import express from "express";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  applyGameAction,
  createGame,
  type GameAction,
  type GameSettings,
  type GameState,
  type Suit
} from "@durak/game-core";
import {
  validateTelegramInitData,
  type TelegramMiniAppUser
} from "./telegramAuth.js";
import { createProfileStore } from "./profileStore.js";

const port = Number(process.env.PORT || 3001);
const profileStore = createProfileStore(process.env.DATABASE_URL);
const app = express();
app.use(express.json());

type ClientGameAction =
  | { type: "choose_trump"; suit: Suit }
  | { type: "attack"; cardId: string }
  | { type: "defend"; attackCardId: string; cardId: string }
  | { type: "transfer"; cardId: string; reverse?: boolean }
  | { type: "take" }
  | { type: "pass_throw_in" };

type ClientMessage =
  | { type: "auth"; initData: string }
  | { type: "ping" }
  | { type: "join_queue"; settings: unknown }
  | { type: "leave_queue" }
  | { type: "leave_room" }
  | { type: "get_leaderboard"; limit?: number }
  | { type: "get_history"; limit?: number }
  | { type: "game_action"; action: ClientGameAction };

interface Session {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  playerId?: string;
  telegramUser?: TelegramMiniAppUser;
  queuedSettings?: GameSettings;
  roomId?: string;
  seat?: number;
}

interface QueueEntry {
  session: Session;
  settings: GameSettings;
}

interface Room {
  id: string;
  members: Session[];
  game: GameState;
  progressApplied: boolean;
  disconnectTimers: Map<number, ReturnType<typeof setTimeout>>;
}

const sessions = new Map<WebSocket, Session>();
const rooms = new Map<string, Room>();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "durak-rpg-server",
    connections: sessions.size,
    rooms: rooms.size
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    telegramConfigured: Boolean(process.env.BOT_TOKEN),
    databaseConfigured: Boolean(process.env.DATABASE_URL)
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function normalizeSettings(input: unknown): GameSettings | undefined {
  if (!input || typeof input !== "object") return undefined;

  const value = input as Record<string, unknown>;
  const mode = value.mode;
  const playerCount = value.playerCount;
  const variant = value.variant;
  const throwInPolicy = value.throwInPolicy;

  if (mode !== "classic" && mode !== "rpg") return undefined;
  if (
    playerCount !== 2 &&
    playerCount !== 3 &&
    playerCount !== 4 &&
    playerCount !== 5 &&
    playerCount !== 6
  ) {
    return undefined;
  }
  if (variant !== "throw-in" && variant !== "transfer") return undefined;
  if (throwInPolicy !== "all" && throwInPolicy !== "neighbors") return undefined;

  const ranked = value.ranked === true;

  return {
    mode,
    playerCount,
    variant: mode === "rpg" ? "transfer" : variant,
    throwInPolicy,
    handSize: 6,
    ranked,
    gameplayItemsEnabled: ranked ? false : value.gameplayItemsEnabled === true
  };
}

function sameQueue(a: GameSettings, b: GameSettings): boolean {
  return (
    a.mode === b.mode &&
    a.playerCount === b.playerCount &&
    a.variant === b.variant &&
    a.throwInPolicy === b.throwInPolicy &&
    a.handSize === b.handSize &&
    a.ranked === b.ranked &&
    a.gameplayItemsEnabled === b.gameplayItemsEnabled
  );
}

function getQueueEntries(): QueueEntry[] {
  const entries: QueueEntry[] = [];

  for (const session of sessions.values()) {
    if (session.queuedSettings && session.roomId === undefined) {
      entries.push({
        session,
        settings: session.queuedSettings
      });
    }
  }

  return entries;
}

function gameViewForSeat(room: Room, seat: number) {
  const game = room.game;
  const self = game.players.find((player) => player.seat === seat);
  if (!self) throw new Error("PLAYER_NOT_FOUND");

  const publicPlayer = (player: GameState["players"][number]) => {
    const member = room.members[player.seat];
    const user = member?.telegramUser;
    return {
      seat: player.seat,
      classId: player.classId,
      handCount: player.hand.length,
      finished: player.finished,
      place: player.place,
      name: user?.first_name ?? `Игрок ${player.seat + 1}`,
      username: user?.username,
      photoUrl: user?.photo_url
    };
  };

  const selfMember = room.members[seat];
  const selfUser = selfMember?.telegramUser;

  return {
    id: game.id,
    settings: game.settings,
    phase: game.phase,
    players: game.players.map(publicPlayer),
    self: {
      seat: self.seat,
      hand: self.hand,
      classId: self.classId,
      ability: self.ability,
      finished: self.finished,
      place: self.place,
      name: selfUser?.first_name ?? `Игрок ${self.seat + 1}`,
      username: selfUser?.username,
      photoUrl: selfUser?.photo_url
    },
    deckCount: game.deck.length,
    discardCount: game.discard.length,
    trumpSuits: game.trumpSuits,
    trumpCard: game.trumpCard,
    table: game.table,
    attackerSeat: game.attackerSeat,
    defenderSeat: game.defenderSeat,
    turnSeat: game.turnSeat,
    direction: game.direction,
    roundAttackLimit: game.roundAttackLimit,
    defenderTaking: game.defenderTaking,
    loserSeat: game.loserSeat,
    draw: game.draw
  };
}

function broadcastRoom(room: Room, event = "game_state") {
  for (const member of room.members) {
    if (member.roomId !== room.id || member.seat === undefined) continue;
    send(member.socket, {
      type: event,
      roomId: room.id,
      state: gameViewForSeat(room, member.seat)
    });
  }
}

function createRoom(entries: QueueEntry[]): Room {
  const roomId = randomUUID();
  const settings = entries[0].settings;
  const members = entries.map((entry) => entry.session);

  members.forEach((session, seat) => {
    session.queuedSettings = undefined;
    session.roomId = roomId;
    session.seat = seat;
  });

  const game = createGame(
    members.map((member) => {
      if (!member.playerId) throw new Error("AUTH_REQUIRED");
      return member.playerId;
    }),
    settings,
    { id: roomId }
  );

  const room: Room = {
    id: roomId,
    members,
    game,
    progressApplied: false,
    disconnectTimers: new Map()
  };

  rooms.set(roomId, room);
  return room;
}

function tryMatchmake() {
  while (true) {
    const queued = getQueueEntries();
    let created = false;

    for (const entry of queued) {
      const targetCount = entry.settings.playerCount;
      const compatible = queued.filter((candidate) =>
        sameQueue(entry.settings, candidate.settings)
      );

      if (compatible.length < targetCount) continue;

      const room = createRoom(compatible.slice(0, targetCount));
      broadcastRoom(room, "match_found");
      created = true;
      break;
    }

    if (!created) break;
  }
}

function parseMessage(raw: RawData): ClientMessage | undefined {
  try {
    return JSON.parse(raw.toString()) as ClientMessage;
  } catch {
    return undefined;
  }
}

function toServerAction(action: ClientGameAction, seat: number): GameAction {
  switch (action.type) {
    case "choose_trump":
      return { type: "choose_trump", playerSeat: seat, suit: action.suit };
    case "attack":
      return { type: "attack", playerSeat: seat, cardId: action.cardId };
    case "defend":
      return {
        type: "defend",
        playerSeat: seat,
        attackCardId: action.attackCardId,
        cardId: action.cardId
      };
    case "transfer":
      return {
        type: "transfer",
        playerSeat: seat,
        cardId: action.cardId,
        reverse: action.reverse
      };
    case "take":
      return { type: "take", playerSeat: seat };
    case "pass_throw_in":
      return { type: "pass_throw_in", playerSeat: seat };
  }
}

async function applyRoomProgress(room: Room) {
  if (room.progressApplied || room.game.phase !== "finished") return;

  room.progressApplied = true;

  try {
    const playerIds = room.game.players.map((player) => player.id);
    const loserId =
      room.game.loserSeat === undefined
        ? undefined
        : room.game.players.find((player) => player.seat === room.game.loserSeat)?.id;

    const profiles = await profileStore.recordMatch(
      room.id,
      playerIds,
      loserId,
      room.game.draw
    );

    const byId = new Map(profiles.map((profile) => [profile.playerId, profile]));

    for (const member of room.members) {
      if (!member.playerId) continue;
      const profile = byId.get(member.playerId);
      if (!profile) continue;

      send(member.socket, {
        type: "profile_updated",
        profile
      });
    }
  } catch (error) {
    room.progressApplied = false;
    console.error("Failed to persist match progression", error);
    for (const member of room.members) {
      send(member.socket, {
        type: "progress_error",
        code: "PROGRESS_SAVE_FAILED"
      });
    }
  }
}

async function handleGameAction(session: Session, action: ClientGameAction) {
  if (!session.roomId || session.seat === undefined) {
    send(session.socket, { type: "game_error", code: "NOT_IN_ROOM" });
    return;
  }

  const room = rooms.get(session.roomId);
  if (!room) {
    send(session.socket, { type: "game_error", code: "ROOM_NOT_FOUND" });
    return;
  }

  try {
    room.game = applyGameAction(
      room.game,
      toServerAction(action, session.seat)
    );
    broadcastRoom(room);

    if (room.game.phase === "finished") {
      await applyRoomProgress(room);
    }
  } catch (error) {
    send(session.socket, {
      type: "game_error",
      code: error instanceof Error ? error.message : "UNKNOWN_GAME_ERROR"
    });
  }
}

function finishRoomByForfeit(room: Room, loserSeat: number) {
  if (room.game.phase === "finished") return;

  room.game = {
    ...room.game,
    phase: "finished",
    turnSeat: undefined,
    table: [],
    roundAttackLimit: 0,
    throwInPassedSeats: [],
    defenderTaking: false,
    loserSeat,
    draw: false
  };

  for (const timer of room.disconnectTimers.values()) {
    clearTimeout(timer);
  }
  room.disconnectTimers.clear();

  broadcastRoom(room);
  void applyRoomProgress(room);
}

function scheduleDisconnectForfeit(session: Session) {
  if (!session.roomId || session.seat === undefined) return;

  const room = rooms.get(session.roomId);
  if (!room || room.game.phase === "finished") return;

  const seat = session.seat;
  const existing = room.disconnectTimers.get(seat);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    room.disconnectTimers.delete(seat);

    const member = room.members[seat];
    const stillDisconnected =
      member.playerId === session.playerId &&
      (!sessions.has(member.socket) || member.socket.readyState !== WebSocket.OPEN);

    if (stillDisconnected) {
      finishRoomByForfeit(room, seat);
    }
  }, 60_000);

  room.disconnectTimers.set(seat, timer);
}

function leaveFinishedRoom(session: Session) {
  if (!session.roomId) {
    send(session.socket, { type: "error", code: "NOT_IN_ROOM" });
    return;
  }

  const room = rooms.get(session.roomId);
  if (!room) {
    session.roomId = undefined;
    session.seat = undefined;
    send(session.socket, { type: "room_left" });
    return;
  }

  if (room.game.phase !== "finished") {
    send(session.socket, { type: "error", code: "GAME_NOT_FINISHED" });
    return;
  }

  const roomId = room.id;
  session.roomId = undefined;
  session.seat = undefined;
  send(session.socket, { type: "room_left" });

  const hasMembers = room.members.some((member) => member.roomId === roomId);
  if (!hasMembers) {
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    rooms.delete(roomId);
  }
}

async function sendLeaderboard(session: Session, requestedLimit?: number) {
  if (!session.authenticated || !session.playerId) {
    send(session.socket, { type: "error", code: "AUTH_REQUIRED" });
    return;
  }

  const limit =
    typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
      : 50;

  try {
    const entries = await profileStore.getLeaderboard(limit);
    send(session.socket, {
      type: "leaderboard",
      entries: entries.map((entry, index) => ({
        rank: index + 1,
        rating: entry.rating,
        games: entry.games,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        currentStreak: entry.currentStreak,
        bestStreak: entry.bestStreak,
        level: entry.level,
        displayName: entry.displayName,
        username: entry.username,
        photoUrl: entry.photoUrl,
        isSelf: entry.playerId === session.playerId
      }))
    });
  } catch (error) {
    console.error("Failed to load leaderboard", error);
    send(session.socket, { type: "error", code: "LEADERBOARD_LOAD_FAILED" });
  }
}

async function sendHistory(session: Session, requestedLimit?: number) {
  if (!session.authenticated || !session.playerId) {
    send(session.socket, { type: "error", code: "AUTH_REQUIRED" });
    return;
  }

  const limit =
    typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
      : 20;

  try {
    const entries = await profileStore.getHistory(session.playerId, limit);
    send(session.socket, {
      type: "match_history",
      entries
    });
  } catch (error) {
    console.error("Failed to load match history", error);
    send(session.socket, { type: "error", code: "HISTORY_LOAD_FAILED" });
  }
}

function restoreRoomMembership(session: Session): Room | undefined {
  if (!session.playerId) return undefined;

  for (const room of rooms.values()) {
    const seat = room.members.findIndex(
      (member) => member.playerId === session.playerId
    );
    if (seat < 0) continue;

    const previous = room.members[seat];
    if (previous === session) return room;

    if (
      previous.socket.readyState === WebSocket.OPEN &&
      sessions.has(previous.socket)
    ) {
      return undefined;
    }

    previous.roomId = undefined;
    previous.seat = undefined;
    const timer = room.disconnectTimers.get(seat);
    if (timer) {
      clearTimeout(timer);
      room.disconnectTimers.delete(seat);
    }
    room.members[seat] = session;
    session.roomId = room.id;
    session.seat = seat;
    return room;
  }

  return undefined;
}

async function authenticateSession(session: Session, initData: string) {
  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    session.authenticated = true;
    session.playerId = `dev:${session.id}`;
    await profileStore.upsertIdentity(session.playerId, {
      displayName: "Dev player"
    });
    const profile = await profileStore.getProfile(session.playerId);
    send(session.socket, {
      type: "auth_ok",
      dev: true,
      user: null,
      profile
    });
    return;
  }

  try {
    const result = validateTelegramInitData(initData, botToken);
    const playerId = `tg:${result.user.id}`;

    const duplicate = [...sessions.values()].find(
      (other) =>
        other !== session &&
        other.authenticated &&
        other.playerId === playerId
    );

    if (duplicate) {
      send(session.socket, { type: "auth_error", code: "ALREADY_CONNECTED" });
      return;
    }

    session.authenticated = true;
    session.playerId = playerId;
    session.telegramUser = result.user;
    const restoredRoom = restoreRoomMembership(session);

    await profileStore.upsertIdentity(playerId, {
      displayName: result.user.first_name,
      username: result.user.username,
      photoUrl: result.user.photo_url
    });
    const profile = await profileStore.getProfile(playerId);

    send(session.socket, {
      type: "auth_ok",
      dev: false,
      user: {
        id: result.user.id,
        firstName: result.user.first_name,
        lastName: result.user.last_name,
        username: result.user.username,
        photoUrl: result.user.photo_url,
        isPremium: result.user.is_premium === true
      },
      profile,
      restoredRoom: restoredRoom?.id
    });

    if (restoredRoom && session.seat !== undefined) {
      send(session.socket, {
        type: "game_state",
        roomId: restoredRoom.id,
        state: gameViewForSeat(restoredRoom, session.seat)
      });
    }
  } catch (error) {
    session.authenticated = false;
    session.playerId = undefined;
    session.telegramUser = undefined;
    send(session.socket, {
      type: "auth_error",
      code: error instanceof Error ? error.message : "AUTH_INVALID"
    });
  }
}

wss.on("connection", (socket) => {
  const session: Session = {
    id: randomUUID(),
    socket,
    authenticated: false
  };
  sessions.set(socket, session);
  send(socket, {
    type: "connected",
    sessionId: session.id,
    requiresAuth: Boolean(process.env.BOT_TOKEN)
  });

  socket.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      send(socket, { type: "error", code: "BAD_MESSAGE" });
      return;
    }

    if (message.type === "auth") {
      void authenticateSession(session, message.initData);
      return;
    }

    if (message.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    if (message.type === "join_queue") {
      if (!session.authenticated || !session.playerId) {
        send(socket, { type: "error", code: "AUTH_REQUIRED" });
        return;
      }

      if (session.roomId) {
        send(socket, { type: "error", code: "ALREADY_IN_ROOM" });
        return;
      }

      const settings = normalizeSettings(message.settings);
      if (!settings) {
        send(socket, { type: "error", code: "INVALID_SETTINGS" });
        return;
      }

      session.queuedSettings = settings;
      send(socket, { type: "queue_joined", settings });
      tryMatchmake();
      return;
    }

    if (message.type === "leave_queue") {
      session.queuedSettings = undefined;
      send(socket, { type: "queue_left" });
      return;
    }

    if (message.type === "leave_room") {
      leaveFinishedRoom(session);
      return;
    }

    if (message.type === "get_leaderboard") {
      void sendLeaderboard(session, message.limit);
      return;
    }

    if (message.type === "get_history") {
      void sendHistory(session, message.limit);
      return;
    }

    if (message.type === "game_action") {
      void handleGameAction(session, message.action);
    }
  });

  socket.on("close", () => {
    session.queuedSettings = undefined;

    if (session.roomId) {
      const room = rooms.get(session.roomId);
      if (room?.game.phase === "finished") {
        const roomId = room.id;
        session.roomId = undefined;
        session.seat = undefined;
        if (!room.members.some((member) => member.roomId === roomId)) {
          for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
          rooms.delete(roomId);
        }
      } else {
        scheduleDisconnectForfeit(session);
      }
    }

    sessions.delete(socket);
  });
});

await profileStore.init();

server.listen(port, () => {
  console.log(`Durak RPG server listening on :${port}`);
});

async function shutdown() {
  await profileStore.close();
  server.close(() => process.exit(0));
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
