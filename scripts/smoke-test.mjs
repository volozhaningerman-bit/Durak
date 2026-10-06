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
  if (typeof WebSocket === "undefined") {
    console.log("SKIP /ws (WebSocket global unavailable in this Node runtime)");
    return;
  }

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket timeout"));
    }, 5000);

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type !== "connected") return;
        clearTimeout(timer);
        socket.close();
        console.log("OK /ws");
        resolve();
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection failed"));
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
