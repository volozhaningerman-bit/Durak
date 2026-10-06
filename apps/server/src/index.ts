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

const port = Number(process.env.PORT || 3001);
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
  | { type: "ping" }
  | { type: "join_queue"; settings: unknown }
  | { type: "leave_queue" }
  | { type: "leave_room" }
  | { type: "game_action"; action: ClientGameAction };

interface Session {
  id: string;
  socket: WebSocket;
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

function gameViewForSeat(game: GameState, seat: number) {
  const self = game.players.find((player) => player.seat === seat);
  if (!self) throw new Error("PLAYER_NOT_FOUND");

  return {
    id: game.id,
    settings: game.settings,
    phase: game.phase,
    players: game.players.map((player) => ({
      id: player.id,
      seat: player.seat,
      classId: player.classId,
      handCount: player.hand.length,
      finished: player.finished,
      place: player.place
    })),
    self: {
      seat: self.seat,
      hand: self.hand,
      classId: self.classId,
      ability: self.ability,
      finished: self.finished,
      place: self.place
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
      state: gameViewForSeat(room.game, member.seat)
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
    members.map((member) => member.id),
    settings,
    { id: roomId }
  );

  const room: Room = {
    id: roomId,
    members,
    game
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

function handleGameAction(session: Session, action: ClientGameAction) {
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
  } catch (error) {
    send(session.socket, {
      type: "game_error",
      code: error instanceof Error ? error.message : "UNKNOWN_GAME_ERROR"
    });
  }
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
  if (!hasMembers) rooms.delete(roomId);
}

wss.on("connection", (socket) => {
  const session: Session = { id: randomUUID(), socket };
  sessions.set(socket, session);
  send(socket, { type: "connected", sessionId: session.id });

  socket.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      send(socket, { type: "error", code: "BAD_MESSAGE" });
      return;
    }

    if (message.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    if (message.type === "join_queue") {
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

    if (message.type === "game_action") {
      handleGameAction(session, message.action);
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
          rooms.delete(roomId);
        }
      }
    }

    sessions.delete(socket);
  });
});

server.listen(port, () => {
  console.log(`Durak RPG server listening on :${port}`);
});
