import WebSocket from "ws";

const baseUrl = (process.env.WEBAPP_URL || process.argv[2] || "").replace(/\/$/, "");

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

async function checkWebSocket() {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, {
      origin: baseUrl
    });

    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket timeout"));
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

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
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
  console.log("Smoke test passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
