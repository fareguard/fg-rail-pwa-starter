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
    const session = getSessionFromCookies();
    const user_email = session?.email?.trim().toLowerCase();

    if (!user_email) {
      return noStoreJson({ ok: false, error: "Not authenticated" }, 401);
    }

    const db = getSupabaseAdmin();

    // 1) Raw email content at rest for THIS user (should always be 0)
    const { count: rawWithContent, error: rawErr } = await db
      .from("raw_emails")
      .select("*", { count: "exact", head: true })
      .eq("user_email", user_email)
      .is("redacted_at", null)
      .or("subject.is.not.null,sender.is.not.null,snippet.is.not.null,body_plain.is.not.null");

    if (rawErr) throw rawErr;

    // 2) Debug raw_input at rest for THIS user (should always be 0)
    const { count: debugRawInputLeft, error: inErr } = await db
      .from("debug_llm_outputs")
      .select("*", { count: "exact", head: true })
      .eq("user_email", user_email)
      .not("raw_input", "is", null);

    if (inErr) throw inErr;

    // 3) Debug raw_output older than 14d for THIS user (should always be 0)
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { count: debugRawOutputOver14d, error: outErr } = await db
      .from("debug_llm_outputs")
      .select("*", { count: "exact", head: true })
      .eq("user_email", user_email)
      .lt("created_at", cutoff)
      .not("raw_output", "is", null);

    if (outErr) throw outErr;

    return noStoreJson({
      ok: true,
      user_email,
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
