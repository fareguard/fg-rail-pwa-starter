// lib/oauth.ts

/** Convert an object into a querystring */
export function toQuery(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

/** Generate an ISO timestamp now + N seconds */
export function nowPlus(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
