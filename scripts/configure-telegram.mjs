const token = process.env.BOT_TOKEN?.trim();
const webAppUrl = process.env.WEBAPP_URL?.trim();
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

if (!webAppUrl || !/^https:\/\//i.test(webAppUrl)) {
  console.error("WEBAPP_URL must be a public https:// URL");
  process.exit(1);
}

if (!webhookSecret || !/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET must be 16-256 chars: A-Z a-z 0-9 _ -");
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;

async function call(method, body) {
  const response = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`${method}: ${JSON.stringify(result)}`);
  }
  return result.result;
}

try {
  const me = await call("getMe", {});

  await call("setWebhook", {
    url: `${webAppUrl}/telegram/webhook`,
    secret_token: webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: true
  });

  await call("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Играть",
      web_app: { url: webAppUrl }
    }
  });

  await call("setMyCommands", {
    commands: [
      { command: "start", description: "Открыть Durak RPG" },
      { command: "play", description: "Играть" }
    ]
  });

  console.log(`Configured @${me.username ?? me.id}`);
  console.log(`Mini App: ${webAppUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
