// lib/session.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

const SESSION_COOKIE_NAME = "fg_session";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

type SessionPayload = {
  email: string;
  iat: number;
};

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4;
  const base64 =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    (pad ? "=".repeat(4 - pad) : "");
  return Buffer.from(base64, "base64");
}

function sign(payloadB64: string): string {
  const h = crypto.createHmac("sha256", SESSION_SECRET as string);
  h.update(payloadB64);
  return base64url(h.digest());
}

/**
 * Read & verify the fg_session cookie from an API Request.
 * Returns { email } or null if missing/invalid.
 */
export async function getSessionFromRequest(
  req: Request
): Promise<{ email: string } | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const match = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return null;

  const rawValue = decodeURIComponent(match.split("=").slice(1).join("="));
  const [payloadB64, sig] = rawValue.split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(payloadB64);
  if (sig !== expectedSig) {
    // signature mismatch → treat as no session
    return null;
  }

  try {
    const json = fromBase64url(payloadB64).toString("utf8");
    const data = JSON.parse(json) as SessionPayload;
    if (!data.email || typeof data.email !== "string") return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

/**
 * Set a signed fg_session cookie on the response for the given email.
 */
export function createSessionCookie(res: NextResponse, email: string): void {
  const payload: SessionPayload = {
    email,
    iat: Math.floor(Date.now() / 1000),
  };

  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  const value = `${payloadB64}.${sig}`;

  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

/**
 * Clear the fg_session cookie (log out).
 */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
