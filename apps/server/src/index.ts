import "dotenv/config";
import express from "express";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { GameSettings } from "@durak/game-core";

const port = Number(process.env.PORT || 3001);
const app = express();
app.use(express.json());

type ClientMessage =
  | { type: "ping" }
  | { type: "join_queue"; settings: GameSettings }
  | { type: "leave_queue" };

interface Session {
  id: string;
  socket: WebSocket;
  queuedSettings?: GameSettings;
}

const sessions = new Map<WebSocket, Session>();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "durak-rpg-server" });
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

function sameQueue(a: GameSettings, b: GameSettings): boolean {
  return (
    a.mode === b.mode &&
    a.playerCount === b.playerCount &&
    a.variant === b.variant &&
    a.throwInPolicy === b.throwInPolicy
  );
}

function tryMatchmake() {
  const queued = [...sessions.values()].filter(
    (session): session is Session & { queuedSettings: GameSettings } =>
      session.queuedSettings !== undefined
  );

  for (const session of queued) {
    const settings = session.queuedSettings;
    const targetCount = settings.playerCount;

    const compatible = queued.filter((candidate) =>
      sameQueue(settings, candidate.queuedSettings)
    );

    if (compatible.length < targetCount) continue;

    const players = compatible.slice(0, targetCount);
    const roomId = randomUUID();

    for (const player of players) {
      player.queuedSettings = undefined;
      send(player.socket, {
        type: "match_found",
        roomId,
        players: players.map((entry) => entry.id)
      });
    }
  }
}

function parseMessage(raw: RawData): ClientMessage | undefined {
  try {
    return JSON.parse(raw.toString()) as ClientMessage;
  } catch {
    return undefined;
  }
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
      session.queuedSettings = message.settings;
      send(socket, { type: "queue_joined", settings: message.settings });
      tryMatchmake();
      return;
    }

    if (message.type === "leave_queue") {
      session.queuedSettings = undefined;
      send(socket, { type: "queue_left" });
    }
  });

  socket.on("close", () => {
    sessions.delete(socket);
  });
});

server.listen(port, () => {
  console.log(`Durak RPG server listening on :${port}`);
});
