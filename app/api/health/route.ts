import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase";

export const dynamic = "force-dynamic"; // ensure not prerendered at build

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.from("profiles").select("user_id").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
