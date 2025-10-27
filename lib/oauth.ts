// lib/oauth.ts
export function toQuery(params: Record<string,string>) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}
export function nowPlus(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
