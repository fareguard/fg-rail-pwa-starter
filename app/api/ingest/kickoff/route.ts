// app/api/ingest/kickoff/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function POST() {
  try {
    const supa = getSupabaseServer();
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser();

    if (authErr || !user?.email || !user?.id) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Ensure a profiles row exists (helps joins elsewhere)
    const admin = getSupabaseAdmin();
    await admin
      .from("profiles")
      .upsert(
        { user_id: user.id, user_email: user.email },
        { onConflict: "user_email" }
      );

    // 🚀 TODO: Hook your real ingest here.
    // e.g. enqueue a job or call your gmail ingest routes.
    // For now we return ok:true so the UI can show "Started scan".
    return NextResponse.json(
      { ok: true, message: "Ingest kicked off for user." },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET() {
  // Allow quick testing via GET as well.
  return POST();
}
