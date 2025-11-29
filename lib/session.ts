// lib/session.ts
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "fg_session";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

type SessionPayload = {
  email: string;
};

function sign(value: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET!).update(value).digest("hex");
}

// Encode { email } into a signed cookie string
export function encodeSession(payload: SessionPayload): string {
  const raw = JSON.stringify(payload);
  const b64 = Buffer.from(raw, "utf8").toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

// Decode + verify cookie string back into { email } or null
export function decodeSession(cookieValue?: string | null): SessionPayload | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [b64, sig] = parts;
  const expected = sign(b64);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed?.email || typeof parsed.email !== "string") return null;
    return { email: parsed.email };
  } catch {
    return null;
  }
}

// Helper used in API routes that return a NextResponse
export function createSessionCookie(res: any, email: string) {
  const value = encodeSession({ email });
  res.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}
