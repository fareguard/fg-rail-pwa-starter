import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ensure not edge

export async function GET() {
  // Don’t print values, just presence
  const present = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.from("profiles").select("user_id").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, env: present });
  } catch (e: any) {
    return NextResponse.json({ ok: false, env: present, error: e.message }, { status: 500 });
  }
}
