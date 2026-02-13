// app/api/privacy/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireSessionFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionFromRequest(req);
    const user_email = session.email;

    const db = getSupabaseAdmin();

    // Raw email content at rest (should be 0 for this user)
    const { count: rawWithContent } = await db
      .from("raw_emails")
      .select("*", { count: "exact", head: true })
      .eq("user_email", user_email)
      .is("redacted_at", null)
      .or("subject.not.is.null,sender.not.is.null,snippet.not.is.null,body_plain.not.is.null");

    // Debug raw_input at rest (should be 0 for this user)
    const { count: debugRawInputLeft } = await db
      .from("debug_llm_outputs")
      .select("*", { count: "exact", head: true })
      .eq("user_email", user_email)
      .not("raw_input", "is", null);

    return noStoreJson({
      ok: true,
      user_email,

      guarantees: {
        raw_email_content_at_rest: (rawWithContent ?? 0) === 0,
        debug_raw_input_at_rest: (debugRawInputLeft ?? 0) === 0,
      },

      counts: {
        raw_emails_with_content: rawWithContent ?? 0,
        debug_raw_input_left: debugRawInputLeft ?? 0,
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
    const msg = e?.message || String(e);
    const status = msg === "Not authenticated" ? 401 : 500;
    return noStoreJson({ ok: false, error: msg }, status);
  }
}
