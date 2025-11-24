// lib/session.ts
import crypto from "crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "fg_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const SESSION_SECRET = process.env.SESSION_SECRET;

function ensureSecret(): string {
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET env var is required");
  }
  return SESSION_SECRET;
}

export type SessionPayload = {
  email: string;
  provider: "google";
  sub?: string;
  iat: number; // seconds
  exp: number; // seconds
};

function b64u(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64uDecode(str: string): Buffer {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function sign(payload: SessionPayload): string {
  const body = b64u(JSON.stringify(payload));
  const hmac = crypto
    .createHmac("sha256", ensureSecret())
    .update(body)
    .digest();
  const sig = b64u(hmac);
  return `${body}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expectedSig = b64u(
    crypto.createHmac("sha256", ensureSecret()).update(body).digest()
  );

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const json = JSON.parse(b64uDecode(body).toString("utf8")) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (json.exp && json.exp < now) return null;
    return json;
  } catch {
    return null;
  }
}

export function createSessionToken(input: {
  email: string;
  provider?: "google";
  sub?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    email: input.email,
    provider: input.provider ?? "google",
    sub: input.sub,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  return sign(payload);
}

export function getSessionFromRequest(
  req: NextRequest
): SessionPayload | null {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  return verifyToken(cookie);
}
