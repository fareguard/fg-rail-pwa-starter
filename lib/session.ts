// lib/session.ts
import { cookies } from "next/headers";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "fg_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret";

/**
 * Sign a value with HMAC so we can detect tampering.
 */
function sign(value: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

/**
 * Encode a simple session payload { email } into a cookie string.
 */
export function encodeSession(payload: { email: string }): string {
  const body = JSON.stringify({
    email: payload.email,
    iat: Date.now(),
  });
  const b64 = Buffer.from(body, "utf8").toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

/**
 * Decode and verify a session cookie value.
 * Returns { email } or null if invalid / missing.
 */
export function decodeSession(
  cookieValue: string | undefined | null
): { email: string } | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [b64, sig] = parts;
  const expectedSig = sign(b64);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  let json: any;
  try {
    const raw = Buffer.from(b64, "base64url").toString("utf8");
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!json || typeof json.email !== "string") return null;
  return { email: json.email as string };
}

/**
 * Create / overwrite the session cookie for the given email.
 * Used in the Google OAuth callback.
 */
export async function createSessionCookie(email: string): Promise<void> {
  const cookieStore = cookies();
  const value = encodeSession({ email });

  cookieStore.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    // 1 year – you can tune this later
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Helper for API routes: read the session from the incoming request.
 * Right now we just use next/headers cookies(), which is already
 * scoped to the current request, so the req param is unused.
 */
export async function getSessionFromRequest(
  _req: Request
): Promise<{ email: string } | null> {
  const cookieStore = cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return decodeSession(raw ?? null);
}
