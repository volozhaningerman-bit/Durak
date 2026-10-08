import WebSocket from "ws";
import { canBeat } from "../packages/game-core/dist/index.js";

const baseUrl = (process.env.WEBAPP_URL || process.argv[2] || "").replace(/\/$/, "");
const runQaMatch = process.env.QA_MATCH_SMOKE === "1";

if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
  console.error("Usage: WEBAPP_URL=https://game.example.com npm run smoke");
  process.exit(1);
}

const wsUrl = baseUrl.replace(/^http/i, "ws") + "/ws";

async function checkHttp(path, validate) {
  const response = await fetch(baseUrl + path, {
    headers: { "user-agent": "durak-rpg-smoke-test" }
  });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  const value = await response.json();
  if (!validate(value)) {
    throw new Error(`${path} returned unexpected payload: ${JSON.stringify(value)}`);
  }
  console.log(`OK ${path}`);
}

function createSocket() {
  return new WebSocket(wsUrl, { origin: baseUrl });
}

async function checkWebSocket() {
  const socket = createSocket();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket greeting timeout"));
    }, 5000);

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== "connected") return;
        clearTimeout(timer);
        socket.close();
        console.log("OK /ws");
        resolve();
      } catch (error) {
        clearTimeout(timer);
        socket.terminate();
        reject(error);
      }
    });
  });
}

function chooseSmokeAction(state) {
  if (state.turnSeat !== state.self.seat || state.phase === "finished") {
    return undefined;
  }

  if (state.phase === "awaiting-trump") {
    const suitCounts = new Map([
      ["clubs", 0],
      ["diamonds", 0],
      ["hearts", 0],
      ["spades", 0]
    ]);
    for (const card of state.self.hand) {
      if (card.kind === "standard") {
        suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1);
      }
    }
    const suit = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { type: "choose_trump", suit };
  }

  if (state.phase === "attacking") {
    const card = state.self.hand.find((entry) => entry.kind === "standard");
    return card ? { type: "attack", cardId: card.id } : undefined;
  }

  if (state.phase === "defending") {
    const open = state.table.find((pair) => !pair.defense);
    if (!open) return undefined;

    const defense = state.self.hand.find((card) =>
      canBeat(open.attack, card, state.trumpSuits)
    );
    if (defense) {
      return {
        type: "defend",
        attackCardId: open.attack.id,
        cardId: defense.id
      };
    }

    if (state.settings.variant === "transfer") {
      const attackRanks = state.table
        .map((pair) => pair.attack)
        .filter((card) => card.kind === "standard")
        .map((card) => card.rank);
      const transfer = state.self.hand.find(
        (card) =>
          card.kind === "standard" &&
          attackRanks.length > 0 &&
          attackRanks.every((rank) => rank === card.rank)
      );
      if (transfer) return { type: "transfer", cardId: transfer.id };
    }

    return { type: "take" };
  }

  if (state.phase === "throwing") {
    const ranks = new Set();
    for (const pair of state.table) {
      if (pair.attack.kind === "standard") ranks.add(pair.attack.rank);
      if (pair.defense?.kind === "standard") ranks.add(pair.defense.rank);
    }
    const card =
      state.table.length < state.roundAttackLimit
        ? state.self.hand.find(
            (entry) => entry.kind === "standard" && ranks.has(entry.rank)
          )
        : undefined;

    return card
      ? { type: "attack", cardId: card.id }
      : { type: "pass_throw_in" };
  }

  return undefined;
}

async function checkQaBotMatch() {
  const socket = createSocket();

  await new Promise((resolve, reject) => {
    let lastState;
    let lastMessageType = "none";
    const timer = setTimeout(() => {
      socket.terminate();
      reject(
        new Error(
          `QA match smoke timeout: lastMessage=${lastMessageType} state=${JSON.stringify(
            lastState
              ? {
                  phase: lastState.phase,
                  turnSeat: lastState.turnSeat,
                  selfSeat: lastState.self?.seat,
                  hand: lastState.self?.hand?.map((card) => card.id),
                  table: lastState.table,
                  deckCount: lastState.deckCount
                }
              : null
          )}`
        )
      );
    }, 45_000);

    let authenticated = false;
    let started = false;
    let finished = false;
    let historyRequested = false;
    let actions = 0;
    let lastActionSignature = "";

    const fail = (error) => {
      clearTimeout(timer);
      socket.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        lastMessageType = message.type ?? "unknown";
        if (message.state) lastState = message.state;

        if (message.type === "connected" && !authenticated) {
          if (message.requiresAuth) {
            fail(new Error("QA smoke requires dev auth without BOT_TOKEN"));
            return;
          }
          socket.send(JSON.stringify({ type: "auth", initData: "" }));
          authenticated = true;
          return;
        }

        if (message.type === "auth_ok" && !started) {
          socket.send(
            JSON.stringify({
              type: "start_qa_bot_match",
              settings: {
                mode: "classic",
                playerCount: 2,
                variant: "throw-in",
                throwInPolicy: "all",
                handSize: 6,
                ranked: true,
                gameplayItemsEnabled: true
              }
            })
          );
          started = true;
          return;
        }

        if (message.type === "profile_updated") {
          fail(new Error("QA match unexpectedly updated profile progression"));
          return;
        }

        if (message.type === "game_error" || message.type === "error") {
          fail(new Error(`QA match server error: ${message.code || "UNKNOWN"}`));
          return;
        }

        if (
          (message.type === "match_found" || message.type === "game_state") &&
          message.state
        ) {
          const state = message.state;
          if (state.qaMatch !== true) {
            fail(new Error("QA match flag missing from game state"));
            return;
          }
          if (state.settings.ranked !== false || state.settings.gameplayItemsEnabled !== false) {
            fail(new Error("QA match did not force safe non-ranked settings"));
            return;
          }

          if (state.phase === "finished") {
            if (!finished) {
              finished = true;
              socket.send(JSON.stringify({ type: "get_history", limit: 5 }));
              historyRequested = true;
            }
            return;
          }

          const action = chooseSmokeAction(state);
          if (!action) return;

          const signature = JSON.stringify({
            phase: state.phase,
            turnSeat: state.turnSeat,
            hand: state.self.hand.map((card) => card.id),
            table: state.table,
            action
          });
          if (signature === lastActionSignature) return;
          lastActionSignature = signature;
          actions += 1;
          socket.send(JSON.stringify({ type: "game_action", action }));
          return;
        }

        if (message.type === "match_history" && historyRequested) {
          if (!Array.isArray(message.entries) || message.entries.length !== 0) {
            fail(new Error("QA match leaked into match history"));
            return;
          }
          if (!finished || actions === 0) {
            fail(new Error("QA match smoke did not play a real game"));
            return;
          }

          clearTimeout(timer);
          socket.send(JSON.stringify({ type: "leave_room" }));
          socket.close();
          console.log(`OK QA bot match (${actions} human actions)`);
          resolve();
        }
      } catch (error) {
        fail(error);
      }
    });

    socket.on("error", fail);
  });
}

try {
  await checkHttp("/health", (value) => value?.ok === true);
  await checkHttp(
    "/api/config",
    (value) =>
      typeof value?.telegramConfigured === "boolean" &&
      typeof value?.databaseConfigured === "boolean"
  );
  await checkWebSocket();
  if (runQaMatch) await checkQaBotMatch();
  console.log("Smoke test passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
