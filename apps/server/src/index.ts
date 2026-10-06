import "dotenv/config";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
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
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function tryMatchmake() {
  const queued = [...sessions.values()].filter((s) => s.queuedSettings);
  for (const session of queued) {
    if (!session.queuedSettings) continue;

    const targetCount = session.queuedSettings.playerCount;
    const compatible = queued.filter((candidate) => {
      if (!candidate.queuedSettings) return false;
      const a = session.queuedSettings;
      const b = candidate.queuedSettings;
      return (
        a.mode === b.mode &&
        a.playerCount === b.playerCount &&
        a.variant === b.variant &&
        a.throwInPolicy === b.throwInPolicy
      );
    });

    if (compatible.length < targetCount) continue;

    const players = compatible.slice(0, targetCount);
    const roomId = randomUUID();
    for (const player of players) {
      player.queuedSettings = undefined;
      send(player.socket, {
        type: "match_found",
        roomId,
        players: players.map((p) => p.id)
      });
    }
  }
}

wss.on("connection", (socket) => {
  const session: Session = { id: randomUUID(), socket };
  sessions.set(socket, session);
  send(socket, { type: "connected", sessionId: session.id });

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;

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
    } catch {
      send(socket, { type: "error", code: "BAD_MESSAGE" });
    }
  });

  socket.on("close", () => {
    sessions.delete(socket);
  });
});

server.listen(port, () => {
  console.log(`Durak RPG server listening on :${port}`);
});
