// app/api/privacy/status/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSessionFromCookies } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET() {
  try {
    // ✅ Don’t expose internal counts to the public internet
    const session = getSessionFromCookies();
    if (!session?.email) return noStoreJson({ ok: false, error: "Not authenticated" }, 401);

    const db = getSupabaseAdmin();

    // Raw email content at rest (should always be 0)
    const { count: rawWithContent } = await db
      .from("raw_emails")
      .select("*", { count: "exact", head: true })
      .is("redacted_at", null)
      .or("subject.is.not.null,sender.is.not.null,snippet.is.not.null,body_plain.is.not.null");

    // Debug raw_input at rest (should always be 0)
    const { count: debugRawInputLeft } = await db
      .from("debug_llm_outputs")
      .select("*", { count: "exact", head: true })
      .not("raw_input", "is", null);

    // Debug raw_output older than 14d (should always be 0)
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { count: debugRawOutputOver14d } = await db
      .from("debug_llm_outputs")
      .select("*", { count: "exact", head: true })
      .lt("created_at", cutoff)
      .not("raw_output", "is", null);

    return noStoreJson({
      ok: true,
      guarantees: {
        raw_email_content_at_rest: (rawWithContent ?? 0) === 0,
        debug_raw_input_at_rest: (debugRawInputLeft ?? 0) === 0,
        debug_raw_output_over_14d: (debugRawOutputOver14d ?? 0) === 0,
      },
      counts: {
        raw_emails_with_content: rawWithContent ?? 0,
        debug_raw_input_left: debugRawInputLeft ?? 0,
        debug_raw_output_left_over_14d: debugRawOutputOver14d ?? 0,
      },
      retention_policy: {
        gmail_scope: "read-only",
        non_train_emails: "redacted immediately",
        train_emails: "parsed then redacted",
        debug_subject_from_days: 7,
        debug_raw_output_days: 14,
        debug_raw_input: "never retained",
      },
    });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || String(e) }, 500);
  }
}
