// lib/session.ts
import type { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const SESSION_COOKIE_NAME = "fg_session";

// 14 days (you already changed this)
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

// Optional extra hardening: sign the session id cookie
// (Not strictly required because UUID is unguessable, but it prevents
// attackers from probing with malformed values and gives you tamper evidence.)
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw new Error("Missing env var: SESSION_SECRET");

export type SessionData = {
  email: string;
  session_id: string;
};

// -----------------------
// low-level cookie helpers
// -----------------------
function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(value: string) {
  const mac = crypto.createHmac("sha256", SESSION_SECRET!).update(value).digest();
  return b64url(mac);
}

function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Cookie value format: "<session_id>.<sig>"
export function encodeSessionId(sessionId: string): string {
  const sig = sign(sessionId);
  return `${sessionId}.${sig}`;
}

export function decodeSessionId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [sessionId, sig] = parts;
  if (!sessionId || !sig) return null;
  const expected = sign(sessionId);
  if (!timingSafeEqualStr(sig, expected)) return null;
  return sessionId;
}

function readCookieFromHeader(req: Request | NextRequest, name: string): string | null {
  const cookieHeader = (req as any).headers?.get?.("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c: string) => c.trim())
    .find((c: string) => c.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

function clearCookie(res: NextResponse) {
  // @ts-ignore
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
}

function setCookie(res: NextResponse, sessionId: string) {
  const value = encodeSessionId(sessionId);

  // @ts-ignore
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

// -----------------------
// main API
// -----------------------

export async function getSessionFromRequest(req: Request | NextRequest): Promise<SessionData | null> {
  const raw = readCookieFromHeader(req, SESSION_COOKIE_NAME);
  const sessionId = decodeSessionId(raw);
  if (!sessionId) return null;

  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("app_sessions")
    .select("id, user_email, expires_at, revoked_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  const exp = new Date(data.expires_at).getTime();
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;

  // best-effort last_seen update (don’t block request)
  db.from("app_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", sessionId)
    .then(() => {})
    .catch(() => {});

  return { email: data.user_email, session_id: data.id };
}

export async function requireSessionFromRequest(req: Request | NextRequest): Promise<SessionData> {
  const s = await getSessionFromRequest(req);
  if (!s?.email) throw new Error("Not authenticated");
  return s;
}

// Creates DB session + sets cookie on response
export async function createAppSessionAndSetCookie(
  req: Request | NextRequest,
  res: NextResponse,
  email: string
): Promise<{ session_id: string }> {
  const db = getSupabaseAdmin();

  const now = Date.now();
  const expiresAt = new Date(now + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  const userAgent = (req as any).headers?.get?.("user-agent") ?? null;
  // Behind Vercel, this is usually present:
  const ip =
    (req as any).headers?.get?.("x-forwarded-for")?.split(",")?.[0]?.trim() ??
    (req as any).headers?.get?.("x-real-ip") ??
    null;

  const { data, error } = await db
    .from("app_sessions")
    .insert({
      user_email: email,
      expires_at: expiresAt,
      user_agent: userAgent,
      ip,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || "Failed to create session");
  }

  setCookie(res, data.id);
  return { session_id: data.id };
}

// Revoke ONE session (this device) + clear cookie
export async function revokeSessionAndClearCookie(
  req: Request | NextRequest,
  res: NextResponse
): Promise<{ revoked: boolean }> {
  const raw = readCookieFromHeader(req, SESSION_COOKIE_NAME);
  const sessionId = decodeSessionId(raw);

  clearCookie(res);

  if (!sessionId) return { revoked: false };

  const db = getSupabaseAdmin();
  await db
    .from("app_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId);

  return { revoked: true };
}

// Revoke ALL sessions for a user (logout everywhere)
export async function revokeAllSessionsForEmail(email: string): Promise<{ revoked: number }> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("app_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_email", email)
    .is("revoked_at", null)
    .select("id");

  if (error) throw new Error(error.message);
  return { revoked: Array.isArray(data) ? data.length : 0 };
}
