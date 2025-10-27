import { NextResponse } from "next/server";
// relative path from app/api/health to lib/
import { supabaseAdmin } from "../../../lib/supabase";

export async function GET() {
  const { error } = await supabaseAdmin.from("profiles").select("user_id").limit(1);
  if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok:true });
}
