// lib/oauth.ts
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "fg_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

// ---- internal helpers ----

function hasSecret(): boolean {
  return typeof SESSION_SECRET === "string" && SESSION_SECRET.length > 0;
}

type SessionPayload = {
  email: string;
  createdAt: number;
};

function sign(body: string): string {
  if (!hasSecret()) return "";
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");
}

// ---- public helpers ----

export function createSessionCookie(email: string) {
  // If mis-configured, don’t crash the app – just skip the cookie.
  if (!hasSecret()) {
    console.error("SESSION_SECRET missing – cannot create session cookie");
    return;
  }

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
  if (!hasSecret()) return null;

  const store = cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  if (!expected) return null;

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
  } catch {
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

// what /api/me uses
export function parseUserFromRequest():
  | { email: string }
  | null {
  const s = getSessionFromCookies();
  if (!s?.email) return null;
  return { email: s.email };
}
