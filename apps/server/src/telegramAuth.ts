import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface TelegramAuthResult {
  user: TelegramMiniAppUser;
  authDate: number;
}

export interface TelegramAuthOptions {
  nowSeconds?: number;
  maxAgeSeconds?: number;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: TelegramAuthOptions = {}
): TelegramAuthResult {
  if (!initData) throw new Error("AUTH_REQUIRED");
  if (!botToken) throw new Error("BOT_TOKEN_MISSING");

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error("AUTH_HASH_MISSING");
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = hmac("WebAppData", botToken);
  const expectedHash = hmac(secretKey, dataCheckString);
  const receivedHashBuffer = Buffer.from(receivedHash, "hex");

  if (
    receivedHashBuffer.length !== expectedHash.length ||
    !timingSafeEqual(receivedHashBuffer, expectedHash)
  ) {
    throw new Error("AUTH_INVALID");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new Error("AUTH_DATE_INVALID");
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 86_400;
  if (authDate > now + 300 || now - authDate > maxAge) {
    throw new Error("AUTH_EXPIRED");
  }

  const rawUser = params.get("user");
  if (!rawUser) throw new Error("AUTH_USER_MISSING");

  let user: TelegramMiniAppUser;
  try {
    user = JSON.parse(rawUser) as TelegramMiniAppUser;
  } catch {
    throw new Error("AUTH_USER_INVALID");
  }

  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") {
    throw new Error("AUTH_USER_INVALID");
  }

  return { user, authDate };
}
