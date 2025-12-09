// lib/session.ts

import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "fg_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type SessionData = {
  email: string;
};

// Encode { email } into a compact cookie value
export function encodeSession(data: SessionData): string {
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

// Decode cookie value back into { email } or null
export function decodeSession(raw: string | null | undefined): SessionData | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed?.email === "string") {
      return { email: parsed.email };
    }
  } catch {
    // ignore bad cookie
  }
  return null;
}

// ----- Read session in a Route Handler from Request -----
export async function getSessionFromRequest(
  req: Request | NextRequest
): Promise<SessionData | null> {
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
// Signature: (email, res)
export function createSessionCookie(email: string, res: NextResponse): void {
  const value = encodeSession({ email });

  // NextResponse has .cookies in the runtime env
  // @ts-ignore
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
