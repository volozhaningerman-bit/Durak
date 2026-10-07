import "dotenv/config";
import express from "express";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
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
const isProduction = process.env.NODE_ENV === "production";
const resolvedWebAppUrl =
  process.env.WEBAPP_URL?.trim() ||
  process.env.RENDER_EXTERNAL_URL?.trim() ||
  "";
const resolvedServerUrl =
  process.env.SERVER_PUBLIC_URL?.trim() ||
  process.env.RENDER_EXTERNAL_URL?.trim() ||
  resolvedWebAppUrl;

function validateProductionConfig() {
  if (!isProduction) return;

  const required = [
    "BOT_TOKEN",
    "DATABASE_URL",
    "TELEGRAM_WEBHOOK_SECRET"
  ] as const;
  const missing: string[] = required.filter((key) => !process.env[key]?.trim());
  if (!resolvedWebAppUrl) missing.push("WEBAPP_URL");
  if (!resolvedServerUrl) missing.push("SERVER_PUBLIC_URL");
  if (missing.length > 0) {
    throw new Error(`Missing required production env: ${missing.join(", ")}`);
  }

  if (!/^https:\/\//i.test(resolvedWebAppUrl)) {
    throw new Error("WEBAPP_URL must use https:// in production");
  }
  if (!/^https:\/\//i.test(resolvedServerUrl)) {
    throw new Error("SERVER_PUBLIC_URL must use https:// in production");
  }
}

validateProductionConfig();

const reconnectGraceMs = Math.max(
  10_000,
  Number(process.env.RECONNECT_GRACE_MS || 60_000)
);
const privateLobbyTtlMs = Math.max(
  60_000,
  Number(process.env.PRIVATE_LOBBY_TTL_MS || 3_600_000)
);
const profileStore = createProfileStore(process.env.DATABASE_URL);
let botUsername: string | undefined;
const app = express();

app.use((req, res, next) => {
  if (resolvedWebAppUrl) {
    try {
      const allowedOrigin = new URL(resolvedWebAppUrl).origin;
      const requestOrigin = req.headers.origin;
      if (requestOrigin === allowedOrigin) {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        res.setHeader("Vary", "Origin");
      }
    } catch {
      // Production validation reports malformed WEBAPP_URL separately.
    }
  }
  next();
});
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
  | { type: "create_private_room"; settings: unknown }
  | { type: "join_private_room"; code: string }
  | { type: "leave_private_room" }
  | { type: "leave_room" }
  | { type: "request_rematch" }
  | { type: "get_leaderboard"; limit?: number }
  | { type: "get_history"; limit?: number }
  | { type: "get_recent_players"; limit?: number }
  | { type: "invite_recent_player"; contactId: string; code: string }
  | { type: "game_action"; action: ClientGameAction };

interface Session {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  playerId?: string;
  telegramUser?: TelegramMiniAppUser;
  queuedSettings?: GameSettings;
  queuedAt?: number;
  roomId?: string;
  seat?: number;
  privateLobbyCode?: string;
  messageWindowStartedAt: number;
  messageCount: number;
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
  progressPersisted: boolean;
  privateMatch: boolean;
  rematchReadySeats: Set<number>;
  disconnectTimers: Map<number, ReturnType<typeof setTimeout>>;
}

interface PrivateLobby {
  code: string;
  settings: GameSettings;
  members: Session[];
  createdAt: number;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const sessions = new Map<WebSocket, Session>();
const rooms = new Map<string, Room>();
const privateLobbies = new Map<string, PrivateLobby>();
const inviteCooldowns = new Map<string, number>();
const aliveSockets = new WeakSet<WebSocket>();

function secureRandom(): number {
  return randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
}

function isAllowedOrigin(origin?: string): boolean {
  const configured = resolvedWebAppUrl;
  if (!configured || !isProduction) return true;
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(configured).origin;
  } catch {
    return false;
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "durak-rpg-server",
    connections: sessions.size,
    rooms: rooms.size,
    privateLobbies: privateLobbies.size
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    telegramConfigured: Boolean(process.env.BOT_TOKEN),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    botUsername
  });
});


interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
}

async function telegramApi<T = unknown>(method: string, body: unknown): Promise<T> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN_MISSING");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });

  const result = await response.json() as { ok?: boolean; description?: string; result?: T };
  if (!response.ok || !result.ok) {
    throw new Error(result.description ?? `Telegram API ${method} failed`);
  }
  return result.result as T;
}

async function configureTelegramIntegration(): Promise<void> {
  const token = process.env.BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !resolvedWebAppUrl || !resolvedServerUrl || !webhookSecret) return;

  const me = await telegramApi<{ username?: string }>("getMe", {});
  botUsername = me?.username;

  await telegramApi("setWebhook", {
    url: `${resolvedServerUrl.replace(/\/$/, "")}/telegram/webhook`,
    secret_token: webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: false
  });

  await telegramApi("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Играть",
      web_app: { url: resolvedWebAppUrl }
    }
  });

  await telegramApi("setMyCommands", {
    commands: [
      { command: "start", description: "Открыть Durak RPG" },
      { command: "play", description: "Играть" }
    ]
  });
}

app.post("/telegram/webhook", async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = req.header("x-telegram-bot-api-secret-token");

  if (!expectedSecret || receivedSecret !== expectedSecret) {
    res.sendStatus(403);
    return;
  }

  res.sendStatus(200);

  const update = req.body as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim();
  if (!chatId || !text || (!text.startsWith("/start") && !text.startsWith("/play"))) {
    return;
  }

  const webAppUrl = resolvedWebAppUrl;
  if (!webAppUrl) return;

  try {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Durak RPG — классический и RPG-режим для 2–6 игроков.",
      reply_markup: {
        inline_keyboard: [[
          {
            text: "🎮 Играть",
            web_app: { url: webAppUrl }
          }
        ]]
      }
    });
  } catch (error) {
    console.error("Failed to answer Telegram command", error);
  }
});

const webDist = path.resolve(process.cwd(), "apps/web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist, {
    index: false,
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
  }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || req.path === "/ws") {
      next();
      return;
    }
    res.sendFile(path.join(webDist, "index.html"));
  });
}

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 64 * 1024
});

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}


function consumeMessageBudget(session: Session): boolean {
  const now = Date.now();
  if (now - session.messageWindowStartedAt >= 10_000) {
    session.messageWindowStartedAt = now;
    session.messageCount = 0;
  }

  session.messageCount += 1;
  return session.messageCount <= 120;
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

  return entries.sort(
    (a, b) =>
      (a.session.queuedAt ?? Number.MAX_SAFE_INTEGER) -
      (b.session.queuedAt ?? Number.MAX_SAFE_INTEGER)
  );
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

  const rematchMembersPresent =
    room.members.length === game.settings.playerCount &&
    room.members.every(
      (member) =>
        member.roomId === room.id &&
        member.seat !== undefined &&
        member.socket.readyState === WebSocket.OPEN
    );

  return {
    id: game.id,
    settings: game.settings,
    phase: game.phase,
    privateMatch: room.privateMatch,
    rematchAvailable:
      room.privateMatch &&
      game.phase === "finished" &&
      room.progressPersisted &&
      rematchMembersPresent,
    rematchReadySeats: [...room.rematchReadySeats].sort((a, b) => a - b),
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
    lastRoundOutcome: game.lastRoundOutcome,
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

function createRoom(
  entries: QueueEntry[],
  options: { privateMatch?: boolean } = {}
): Room {
  const roomId = randomUUID();
  const settings = entries[0].settings;
  const members = entries.map((entry) => entry.session);

  members.forEach((session, seat) => {
    session.queuedSettings = undefined;
    session.queuedAt = undefined;
    session.privateLobbyCode = undefined;
    session.roomId = roomId;
    session.seat = seat;
  });

  const playerIds = members.map((member) => {
    if (!member.playerId) throw new Error("AUTH_REQUIRED");
    return member.playerId;
  });

  const game = createGame(
    playerIds,
    settings,
    { id: roomId, random: secureRandom }
  );

  void profileStore.touchContacts(playerIds)
    .then(() => Promise.all(members.map((member) => sendRecentPlayers(member, 8))))
    .catch((error) => {
      console.error("Failed to remember room contacts", error);
    });

  const room: Room = {
    id: roomId,
    members,
    game,
    progressApplied: false,
    progressPersisted: false,
    privateMatch: options.privateMatch === true,
    rematchReadySeats: new Set(),
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


const PRIVATE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePrivateCode(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += PRIVATE_CODE_ALPHABET[randomInt(0, PRIVATE_CODE_ALPHABET.length)];
    }
    if (!privateLobbies.has(code)) return code;
  }
  throw new Error("PRIVATE_ROOM_CODE_EXHAUSTED");
}

function privateLobbyMemberConnected(member: Session): boolean {
  return sessions.has(member.socket) && member.socket.readyState === WebSocket.OPEN;
}

function privateLobbyPayload(lobby: PrivateLobby, session: Session) {
  const connectedPlayers = lobby.members.filter(privateLobbyMemberConnected).length;
  return {
    type: "private_room",
    code: lobby.code,
    settings: lobby.settings,
    members: lobby.members.map((member, index) => ({
      index,
      name: member.telegramUser?.first_name ?? `Игрок ${index + 1}`,
      username: member.telegramUser?.username,
      photoUrl: member.telegramUser?.photo_url,
      isSelf: member === session,
      isHost: index === 0,
      connected: privateLobbyMemberConnected(member)
    })),
    currentPlayers: connectedPlayers,
    requiredPlayers: lobby.settings.playerCount,
    isHost: lobby.members[0] === session
  };
}

function broadcastPrivateLobby(lobby: PrivateLobby) {
  for (const member of lobby.members) {
    send(member.socket, privateLobbyPayload(lobby, member));
  }
}

function leavePrivateLobby(session: Session, sendConfirmation = true) {
  const code = session.privateLobbyCode;
  if (!code) {
    if (sendConfirmation) {
      send(session.socket, { type: "error", code: "NOT_IN_PRIVATE_ROOM" });
    }
    return;
  }

  const lobby = privateLobbies.get(code);
  session.privateLobbyCode = undefined;

  if (!lobby) {
    if (sendConfirmation) send(session.socket, { type: "private_room_left" });
    return;
  }

  if (session.playerId) {
    const timer = lobby.disconnectTimers.get(session.playerId);
    if (timer) clearTimeout(timer);
    lobby.disconnectTimers.delete(session.playerId);
  }

  lobby.members = lobby.members.filter((member) => member !== session);

  if (lobby.members.length === 0) {
    for (const timer of lobby.disconnectTimers.values()) clearTimeout(timer);
    lobby.disconnectTimers.clear();
    privateLobbies.delete(code);
  } else {
    broadcastPrivateLobby(lobby);
  }

  if (sendConfirmation) send(session.socket, { type: "private_room_left" });
}

function startPrivateLobbyIfReady(lobby: PrivateLobby) {
  const everyoneConnected =
    lobby.members.length === lobby.settings.playerCount &&
    lobby.members.every(privateLobbyMemberConnected);

  if (!everyoneConnected) {
    broadcastPrivateLobby(lobby);
    return;
  }

  for (const timer of lobby.disconnectTimers.values()) clearTimeout(timer);
  lobby.disconnectTimers.clear();
  privateLobbies.delete(lobby.code);
  const entries: QueueEntry[] = lobby.members.map((session) => ({
    session,
    settings: lobby.settings
  }));
  const room = createRoom(entries, { privateMatch: true });
  broadcastRoom(room, "match_found");
}

function createPrivateLobby(session: Session, input: unknown) {
  if (!session.authenticated || !session.playerId) {
    send(session.socket, { type: "error", code: "AUTH_REQUIRED" });
    return;
  }
  if (session.roomId) {
    send(session.socket, { type: "error", code: "ALREADY_IN_ROOM" });
    return;
  }
  if (session.privateLobbyCode) {
    send(session.socket, { type: "error", code: "ALREADY_IN_PRIVATE_ROOM" });
    return;
  }

  const settings = normalizeSettings(input);
  if (!settings) {
    send(session.socket, { type: "error", code: "INVALID_SETTINGS" });
    return;
  }

  const privateSettings: GameSettings = {
    ...settings,
    ranked: false
  };

  session.queuedSettings = undefined;
  session.queuedAt = undefined;
  const code = generatePrivateCode();
  const lobby: PrivateLobby = {
    code,
    settings: privateSettings,
    members: [session],
    createdAt: Date.now(),
    disconnectTimers: new Map()
  };
  session.privateLobbyCode = code;
  privateLobbies.set(code, lobby);
  broadcastPrivateLobby(lobby);
}

function joinPrivateLobby(session: Session, rawCode: string) {
  if (!session.authenticated || !session.playerId) {
    send(session.socket, { type: "error", code: "AUTH_REQUIRED" });
    return;
  }
  if (session.roomId) {
    send(session.socket, { type: "error", code: "ALREADY_IN_ROOM" });
    return;
  }
  if (session.privateLobbyCode) {
    send(session.socket, { type: "error", code: "ALREADY_IN_PRIVATE_ROOM" });
    return;
  }

  const code = String(rawCode ?? "").trim().toUpperCase();
  const lobby = privateLobbies.get(code);
  if (!lobby) {
    send(session.socket, { type: "error", code: "PRIVATE_ROOM_NOT_FOUND" });
    return;
  }
  if (lobby.members.length >= lobby.settings.playerCount) {
    send(session.socket, { type: "error", code: "PRIVATE_ROOM_FULL" });
    return;
  }
  if (lobby.members.some((member) => member.playerId === session.playerId)) {
    send(session.socket, { type: "error", code: "ALREADY_IN_PRIVATE_ROOM" });
    return;
  }

  session.queuedSettings = undefined;
  session.queuedAt = undefined;
  session.privateLobbyCode = code;
  lobby.members.push(session);
  const lobbyPlayerIds = lobby.members
    .map((member) => member.playerId)
    .filter((playerId): playerId is string => Boolean(playerId));
  void profileStore.touchContacts(lobbyPlayerIds)
    .then(() => Promise.all(lobby.members.map((member) => sendRecentPlayers(member, 8))))
    .catch((error) => {
      console.error("Failed to remember private lobby contacts", error);
    });
  startPrivateLobbyIfReady(lobby);
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

    const winnerOrder = room.game.players
      .filter((player) => player.id !== loserId)
      .sort(
        (a, b) =>
          (a.place ?? Number.MAX_SAFE_INTEGER) -
            (b.place ?? Number.MAX_SAFE_INTEGER) ||
          a.seat - b.seat
      )
      .map((player) => player.id);

    const profiles = await profileStore.recordMatch(
      room.id,
      playerIds,
      loserId,
      room.game.draw,
      room.game.settings.ranked,
      winnerOrder
    );

    const byId = new Map(profiles.map((profile) => [profile.playerId, profile]));

    for (const member of room.members) {
      if (!member.playerId) continue;
      const profile = byId.get(member.playerId);
      if (!profile) continue;

      const [latest] = await profileStore.getHistory(member.playerId, 1);
      const progress =
        latest?.matchId === room.id
          ? {
              result: latest.result,
              ranked: latest.ranked,
              ratingBefore: latest.ratingBefore,
              ratingAfter: latest.ratingAfter,
              ratingDelta: latest.ratingAfter - latest.ratingBefore
            }
          : undefined;

      send(member.socket, {
        type: "profile_updated",
        profile,
        progress
      });
    }

    room.progressPersisted = true;
    if (room.privateMatch) broadcastRoom(room);
  } catch (error) {
    room.progressApplied = false;
    room.progressPersisted = false;
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

  for (const member of room.members) {
    const disconnected =
      !sessions.has(member.socket) || member.socket.readyState !== WebSocket.OPEN;
    if (disconnected) {
      member.roomId = undefined;
      member.seat = undefined;
    }
  }

  room.game = {
    ...room.game,
    phase: "finished",
    turnSeat: undefined,
    table: [],
    lastRoundOutcome: "discard",
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
  }, reconnectGraceMs);

  room.disconnectTimers.set(seat, timer);
}

function requestPrivateRematch(session: Session) {
  if (!session.roomId || session.seat === undefined) {
    send(session.socket, { type: "game_error", code: "NOT_IN_ROOM" });
    return;
  }

  const room = rooms.get(session.roomId);
  if (!room || !room.privateMatch || room.game.phase !== "finished") {
    send(session.socket, { type: "game_error", code: "REMATCH_UNAVAILABLE" });
    return;
  }

  if (!room.progressPersisted) {
    send(session.socket, { type: "game_error", code: "REMATCH_RESULT_PENDING" });
    return;
  }

  const everyonePresent =
    room.members.length === room.game.settings.playerCount &&
    room.members.every(
      (member) =>
        member.roomId === room.id &&
        member.seat !== undefined &&
        member.socket.readyState === WebSocket.OPEN
    );

  if (!everyonePresent) {
    room.rematchReadySeats.clear();
    broadcastRoom(room);
    send(session.socket, { type: "game_error", code: "REMATCH_UNAVAILABLE" });
    return;
  }

  room.rematchReadySeats.add(session.seat);

  if (room.rematchReadySeats.size < room.members.length) {
    broadcastRoom(room);
    return;
  }

  const oldRoomId = room.id;
  const entries: QueueEntry[] = room.members.map((member) => ({
    session: member,
    settings: room.game.settings
  }));

  for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
  room.disconnectTimers.clear();

  const rematchRoom = createRoom(entries, { privateMatch: true });
  rooms.delete(oldRoomId);
  broadcastRoom(rematchRoom, "match_found");
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
  } else if (room.privateMatch) {
    room.rematchReadySeats.clear();
    broadcastRoom(room);
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

async function sendRecentPlayers(session: Session, requestedLimit?: number) {
  if (!session.authenticated || !session.playerId) {
    send(session.socket, { type: "error", code: "AUTH_REQUIRED" });
    return;
  }

  const limit =
    typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(20, Math.floor(requestedLimit)))
      : 8;

  try {
    const entries = await profileStore.getRecentContacts(session.playerId, limit);
    send(session.socket, {
      type: "recent_players",
      entries: entries.map((entry) => ({
        contactId: entry.playerId,
        name: entry.displayName,
        username: entry.username,
        photoUrl: entry.photoUrl,
        lastSeen: entry.lastSeen
      }))
    });
  } catch (error) {
    console.error("Failed to load recent players", error);
    send(session.socket, { type: "error", code: "RECENT_PLAYERS_LOAD_FAILED" });
  }
}

async function inviteRecentPlayer(
  session: Session,
  contactId: string,
  rawCode: string
) {
  if (!session.authenticated || !session.playerId) {
    send(session.socket, { type: "error", code: "AUTH_REQUIRED" });
    return;
  }

  const code = String(rawCode ?? "").trim().toUpperCase();
  const lobby = privateLobbies.get(code);
  if (!lobby || session.privateLobbyCode !== code || !lobby.members.includes(session)) {
    send(session.socket, { type: "error", code: "PRIVATE_ROOM_NOT_FOUND" });
    return;
  }

  const contacts = await profileStore.getRecentContacts(session.playerId, 20);
  const contact = contacts.find((entry) => entry.playerId === contactId);
  if (!contact) {
    send(session.socket, { type: "error", code: "INVITE_CONTACT_NOT_FOUND" });
    return;
  }

  const cooldownKey = `${session.playerId}:${contactId}`;
  const lastInvite = inviteCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastInvite < 20_000) {
    send(session.socket, { type: "error", code: "INVITE_COOLDOWN" });
    return;
  }

  const telegramId = contactId.startsWith("tg:")
    ? Number(contactId.slice(3))
    : NaN;
  if (!Number.isSafeInteger(telegramId) || !botUsername) {
    send(session.socket, { type: "error", code: "INVITE_UNAVAILABLE" });
    return;
  }

  const senderName = session.telegramUser?.first_name ?? "Игрок";
  const inviteUrl =
    `https://t.me/${botUsername}?startapp=room_${code}&mode=fullscreen`;

  try {
    await telegramApi("sendMessage", {
      chat_id: telegramId,
      text: `🎴 ${senderName} приглашает тебя в Durak RPG`,
      reply_markup: {
        inline_keyboard: [[
          { text: "🎮 Войти в комнату", url: inviteUrl }
        ]]
      }
    });
    inviteCooldowns.set(cooldownKey, Date.now());
    send(session.socket, {
      type: "invite_sent",
      contactId,
      name: contact.displayName
    });
  } catch (error) {
    console.error("Failed to send private invite", error);
    send(session.socket, { type: "error", code: "INVITE_FAILED" });
  }
}

function restorePrivateLobbyMembership(session: Session): PrivateLobby | undefined {
  if (!session.playerId) return undefined;

  for (const lobby of privateLobbies.values()) {
    const index = lobby.members.findIndex(
      (member) => member.playerId === session.playerId
    );
    if (index < 0) continue;

    const previous = lobby.members[index];
    if (previous.privateLobbyCode !== lobby.code) continue;
    if (previous === session) return lobby;

    if (privateLobbyMemberConnected(previous)) {
      return undefined;
    }

    const timer = lobby.disconnectTimers.get(session.playerId);
    if (timer) clearTimeout(timer);
    lobby.disconnectTimers.delete(session.playerId);

    previous.privateLobbyCode = undefined;
    lobby.members[index] = session;
    session.privateLobbyCode = lobby.code;
    broadcastPrivateLobby(lobby);
    return lobby;
  }

  return undefined;
}

function schedulePrivateLobbyDisconnect(session: Session) {
  const code = session.privateLobbyCode;
  const playerId = session.playerId;
  if (!code || !playerId) return;

  const lobby = privateLobbies.get(code);
  if (!lobby || !lobby.members.includes(session)) return;

  const existing = lobby.disconnectTimers.get(playerId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    lobby.disconnectTimers.delete(playerId);

    const stillReserved =
      session.privateLobbyCode === code &&
      lobby.members.includes(session) &&
      !privateLobbyMemberConnected(session);

    if (stillReserved) {
      leavePrivateLobby(session, false);
    }
  }, reconnectGraceMs);

  lobby.disconnectTimers.set(playerId, timer);
  broadcastPrivateLobby(lobby);
}

function restoreRoomMembership(session: Session): Room | undefined {
  if (!session.playerId) return undefined;

  for (const room of rooms.values()) {
    const seat = room.members.findIndex(
      (member) => member.playerId === session.playerId
    );
    if (seat < 0) continue;

    const previous = room.members[seat];
    if (previous.roomId !== room.id) continue;
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
    if (isProduction) {
      send(session.socket, { type: "auth_error", code: "SERVER_MISCONFIGURED" });
      return;
    }

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
      duplicate.authenticated = false;
      duplicate.queuedSettings = undefined;
      duplicate.queuedAt = undefined;
      sessions.delete(duplicate.socket);
      duplicate.socket.close(4001, "SESSION_REPLACED");
    }

    session.authenticated = true;
    session.playerId = playerId;
    session.telegramUser = result.user;
    const restoredRoom = restoreRoomMembership(session);
    const restoredPrivateLobby = restoredRoom
      ? undefined
      : restorePrivateLobbyMembership(session);

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
      restoredRoom: restoredRoom?.id,
      restoredPrivateLobby: restoredPrivateLobby?.code
    });

    void sendRecentPlayers(session, 8);

    if (restoredRoom && session.seat !== undefined) {
      send(session.socket, {
        type: "game_state",
        roomId: restoredRoom.id,
        state: gameViewForSeat(restoredRoom, session.seat)
      });
    } else if (restoredPrivateLobby && privateLobbies.has(restoredPrivateLobby.code)) {
      send(
        session.socket,
        privateLobbyPayload(restoredPrivateLobby, session)
      );
      startPrivateLobbyIfReady(restoredPrivateLobby);
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

wss.on("connection", (socket, request) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    socket.close(1008, "ORIGIN_NOT_ALLOWED");
    return;
  }

  aliveSockets.add(socket);
  socket.on("pong", () => {
    aliveSockets.add(socket);
  });

  const session: Session = {
    id: randomUUID(),
    socket,
    authenticated: false,
    messageWindowStartedAt: Date.now(),
    messageCount: 0
  };
  sessions.set(socket, session);
  send(socket, {
    type: "connected",
    sessionId: session.id,
    requiresAuth: Boolean(process.env.BOT_TOKEN)
  });

  socket.on("message", (raw) => {
    if (!consumeMessageBudget(session)) {
      send(socket, { type: "error", code: "RATE_LIMITED" });
      socket.close(1008, "RATE_LIMITED");
      return;
    }

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
      if (session.privateLobbyCode) {
        send(socket, { type: "error", code: "ALREADY_IN_PRIVATE_ROOM" });
        return;
      }

      const settings = normalizeSettings(message.settings);
      if (!settings) {
        send(socket, { type: "error", code: "INVALID_SETTINGS" });
        return;
      }

      session.queuedSettings = settings;
      session.queuedAt = Date.now();
      send(socket, { type: "queue_joined", settings });
      tryMatchmake();
      return;
    }

    if (message.type === "leave_queue") {
      session.queuedSettings = undefined;
      session.queuedAt = undefined;
      send(socket, { type: "queue_left" });
      return;
    }

    if (message.type === "create_private_room") {
      createPrivateLobby(session, message.settings);
      return;
    }

    if (message.type === "join_private_room") {
      joinPrivateLobby(session, message.code);
      return;
    }

    if (message.type === "leave_private_room") {
      leavePrivateLobby(session);
      return;
    }

    if (message.type === "leave_room") {
      leaveFinishedRoom(session);
      return;
    }

    if (message.type === "request_rematch") {
      requestPrivateRematch(session);
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

    if (message.type === "get_recent_players") {
      void sendRecentPlayers(session, message.limit);
      return;
    }

    if (message.type === "invite_recent_player") {
      void inviteRecentPlayer(session, message.contactId, message.code);
      return;
    }

    if (message.type === "game_action") {
      void handleGameAction(session, message.action);
    }
  });

  socket.on("close", () => {
    session.queuedSettings = undefined;
    session.queuedAt = undefined;
    if (session.privateLobbyCode) {
      schedulePrivateLobbyDisconnect(session);
    }

    if (session.roomId) {
      const room = rooms.get(session.roomId);
      if (room?.game.phase === "finished") {
        const roomId = room.id;
        session.roomId = undefined;
        session.seat = undefined;
        if (!room.members.some((member) => member.roomId === roomId)) {
          for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
          rooms.delete(roomId);
        } else if (room.privateMatch) {
          room.rematchReadySeats.clear();
          broadcastRoom(room);
        }
      } else {
        scheduleDisconnectForfeit(session);
      }
    }

    sessions.delete(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!aliveSockets.has(socket)) {
      socket.terminate();
      continue;
    }

    aliveSockets.delete(socket);
    socket.ping();
  }
}, 20_000);

heartbeat.unref();

const privateLobbyCleanup = setInterval(() => {
  const cutoff = Date.now() - privateLobbyTtlMs;

  for (const [code, lobby] of privateLobbies) {
    if (lobby.createdAt > cutoff) continue;

    privateLobbies.delete(code);
    for (const timer of lobby.disconnectTimers.values()) clearTimeout(timer);
    lobby.disconnectTimers.clear();
    for (const member of lobby.members) {
      if (member.privateLobbyCode === code) {
        member.privateLobbyCode = undefined;
      }
      send(member.socket, { type: "error", code: "PRIVATE_ROOM_EXPIRED" });
      send(member.socket, { type: "private_room_left" });
    }
  }
}, 60_000);

privateLobbyCleanup.unref();

await profileStore.init();

server.listen(port, () => {
  console.log(`Durak RPG server listening on :${port}`);
});

if (process.env.BOT_TOKEN) {
  void configureTelegramIntegration()
    .then(() => {
      console.log(
        `Telegram bot configured${botUsername ? ` @${botUsername}` : ""}`
      );
    })
    .catch((error) => {
      console.error("Failed to configure Telegram bot", error);
    });
}

async function shutdown() {
  clearInterval(heartbeat);
  clearInterval(privateLobbyCleanup);
  for (const room of rooms.values()) {
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
  }
  for (const lobby of privateLobbies.values()) {
    for (const timer of lobby.disconnectTimers.values()) clearTimeout(timer);
  }
  privateLobbies.clear();
  wss.close();
  await profileStore.close();
  server.close(() => process.exit(0));
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
