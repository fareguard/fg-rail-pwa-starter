// lib/session.ts
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "fg_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

export type SessionPayload = {
  email: string;
  iat: number;
};

// --- small helpers ---------------------------------------------------------

function base64url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(data: string): string {
  const h = crypto.createHmac("sha256", SESSION_SECRET);
  h.update(data);
  return base64url(h.digest());
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

export function encodeSession(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const body = base64url(Buffer.from(json, "utf8"));
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function decodeSession(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (sign(body) !== sig) return null;

  try {
    const json = Buffer.from(body, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed.email !== "string") return null;
    return { email: parsed.email, iat: parsed.iat ?? 0 };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read session from a Request (for Route Handlers)
// ---------------------------------------------------------------------------

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const parts = cookieHeader.split(";");

  let token: string | null = null;
  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      token = decodeURIComponent(rest.join("="));
      break;
    }
  }
  return decodeSession(token);
}
