// app/api/trips/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}

export async function GET() {
  try {
    const supabase = getServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const email = auth?.user?.email ?? null;

    if (!email) return NextResponse.json({ trips: [] }, { status: 200 });

    const { data, error } = await supabase
      .from("trips")
      .select(
        "id, origin, destination, operator, retailer, booking_ref, depart_planned, arrive_planned, is_ticket, status, created_at"
      )
      .eq("user_email", email)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ trips: [] }, { status: 200 });

    return NextResponse.json({ trips: data ?? [] }, { status: 200 });
  } catch {
    return NextResponse.json({ trips: [] }, { status: 200 });
  }
}
