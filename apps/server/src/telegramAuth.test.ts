import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "./telegramAuth.js";

const token = "123456:test-token";
const now = 1_800_000_000;

function sign(fields: Record<string, string>): string {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("Telegram Mini App auth", () => {
  it("accepts correctly signed fresh initData", () => {
    const initData = sign({
      auth_date: String(now - 30),
      query_id: "query",
      user: JSON.stringify({ id: 42, first_name: "Test", username: "tester" })
    });

    const result = validateTelegramInitData(initData, token, { nowSeconds: now });
    expect(result.user.id).toBe(42);
    expect(result.user.username).toBe("tester");
  });

  it("rejects tampered user data", () => {
    const initData = sign({
      auth_date: String(now - 30),
      user: JSON.stringify({ id: 42, first_name: "Test" })
    }).replace("%22Test%22", "%22Hacker%22");

    expect(() =>
      validateTelegramInitData(initData, token, { nowSeconds: now })
    ).toThrow("AUTH_INVALID");
  });

  it("rejects stale initData", () => {
    const initData = sign({
      auth_date: String(now - 90_000),
      user: JSON.stringify({ id: 42, first_name: "Test" })
    });

    expect(() =>
      validateTelegramInitData(initData, token, { nowSeconds: now })
    ).toThrow("AUTH_EXPIRED");
  });
});
