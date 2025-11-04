// lib/supabase.ts — compatibility shim so older imports still work
import { NextResponse } from "next/server";
export { getSupabaseAdmin }   from "./supabase-admin";
export { getSupabaseServer }  from "./supabase-server";
export { getSupabaseBrowser } from "./supabase-browser";

/** Return JSON with no-store so pages/routes don't get cached by Vercel */
export function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}
