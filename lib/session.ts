// lib/session.ts
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "fg_session";

export type SessionPayload = {
  email: string;
  createdAt: number;
};

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET env var is missing");
  }
  return secret;
}

export function encodeSession(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const secret = getSessionSecret();
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("hex");
  return `${b64}.${sig}`;
}

export function decodeSession(
  raw: string | undefined | null
): SessionPayload | null {
  if (!raw) return null;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return null;

  const secret = getSessionSecret();
  const expected = crypto.createHmac("sha256", secret).update(b64).digest("hex");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    if (sig !== expected) return null;
  }

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    if (!payload?.email) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Helper for API routes: pull the session from the Request cookies
// ---------------------------------------------------------------------

function readCookieFromHeader(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";");

  for (const part of parts) {
    const [rawKey, ...rawVal] = part.trim().split("=");
    if (!rawKey) continue;
    if (rawKey === name) {
      return decodeURIComponent(rawVal.join("="));
    }
  }
  return undefined;
}

/**
 * Used in API route handlers that only have the `Request` object,
 * e.g. app/api/ingest/google/save/route.ts
 */
export function getSessionFromRequest(req: Request): SessionPayload | null {
  const cookieHeader = req.headers.get("cookie");
  const raw = readCookieFromHeader(cookieHeader, SESSION_COOKIE_NAME);
  return decodeSession(raw);
}
