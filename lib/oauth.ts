// lib/oauth.ts
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "fg_session";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

type SessionPayload = {
  email: string;
  createdAt: number;
};

// HMAC signer
function sign(body: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET as string)
    .update(body)
    .digest("base64url");
}

export function createSessionCookie(email: string) {
  const payload: SessionPayload = {
    email,
    createdAt: Date.now(),
  };

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  const value = `${body}.${sig}`;

  const store = cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

export function destroySessionCookie() {
  const store = cookies();
  store.delete(COOKIE_NAME);
}

export function getSessionFromCookies(): SessionPayload | null {
  const store = cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);

  // timing-safe comparison
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as SessionPayload;
  } catch {
    return null;
  }
}

// Simple helper your routes can call
export function parseUserFromRequest():
  | { email: string }
  | null {
  const s = getSessionFromCookies();
  if (!s?.email) return null;
  return { email: s.email };
}
