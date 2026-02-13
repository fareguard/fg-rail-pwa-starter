// lib/session.ts
import { cookies } from "next/headers";
import crypto from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "fg_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Must be set in Railway/Env. Use a long random string.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  // Fail fast in production to avoid running unsigned sessions.
  // (If you prefer not to crash locally, wrap this in a NODE_ENV check.)
  throw new Error("Missing env var: SESSION_SECRET");
}

export type SessionData = {
  email: string;
};

// -----------------------
// helpers
// -----------------------
function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlToBuf(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const s = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(s, "base64");
}

function sign(payloadB64: string) {
  const mac = crypto.createHmac("sha256", SESSION_SECRET!).update(payloadB64).digest();
  return b64url(mac);
}

function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Encode {email} -> "payload.signature"
export function encodeSession(data: SessionData): string {
  const payload = b64url(JSON.stringify(data));
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

// Decode "payload.signature" -> {email} | null
export function decodeSession(raw: string | null | undefined): SessionData | null {
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64);

  if (!timingSafeEqualStr(sig, expected)) return null;

  try {
    const json = b64urlToBuf(payloadB64).toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed?.email === "string" && parsed.email.trim().length > 0) {
      return { email: parsed.email.trim() };
    }
  } catch {
    return null;
  }

  return null;
}

// ----- Read session in a Route Handler from Request -----
export async function getSessionFromRequest(req: Request | NextRequest): Promise<SessionData | null> {
  const cookieHeader = (req as any).headers?.get?.("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c: string) => c.trim())
    .find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!match) return null;

  const value = decodeURIComponent(match.split("=").slice(1).join("="));
  return decodeSession(value);
}

// ----- Read session via next/headers in server code -----
export function getSessionFromCookies(): SessionData | null {
  const jar = cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  return decodeSession(raw);
}

// ----- Write the session cookie on a NextResponse -----
export function createSessionCookie(email: string, res: NextResponse): void {
  const value = encodeSession({ email });

  // @ts-ignore NextResponse cookies available at runtime
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}
