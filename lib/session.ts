// lib/session.ts
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "fg_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_SECRET = process.env.SESSION_SECRET;

// Lazy check so build doesn't explode if env isn't set yet
function ensureSecret(): string {
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET env var is required");
  }
  return SESSION_SECRET;
}

export type SessionPayload = {
  user_id: string; // Google sub
  email: string;
  exp: number; // unix seconds
};

// --- tiny base64url helpers ---
function b64uEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64uDecode(str: string) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

// --- HMAC signing ---
function sign(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const body = b64uEncode(Buffer.from(json, "utf8"));
  const hmac = crypto
    .createHmac("sha256", ensureSecret())
    .update(body)
    .digest();
  const sig = b64uEncode(hmac);
  return `${body}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expectedSig = b64uEncode(
    crypto.createHmac("sha256", ensureSecret()).update(body).digest()
  );

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const json = b64uDecode(body).toString("utf8");
    const payload = JSON.parse(json) as SessionPayload;

    if (!payload.exp || typeof payload.user_id !== "string") return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    return payload;
  } catch {
    return null;
  }
}

// --- Public helpers for routes/components ---

export function getSession(): SessionPayload | null {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verify(token);
}

export function setSessionCookie(
  res: Response & { headers: Headers },
  payload: { user_id: string; email: string }
) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = sign({ ...payload, exp });

  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure", // remove in dev if you’re strictly http
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join("; ");

  res.headers.append("Set-Cookie", cookie);
}

export function clearSessionCookie(res: Response & { headers: Headers }) {
  const cookie = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=0",
  ].join("; ");
  res.headers.append("Set-Cookie", cookie);
}
