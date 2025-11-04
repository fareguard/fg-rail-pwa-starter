// app/api/me/route.ts
import { noStoreJson, getSupabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = false as const;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) return noStoreJson({ authenticated: false, error: error.message }, 200);
    if (!user) return noStoreJson({ authenticated: false }, 200);

    // Optional: fetch a profile row if you want to gate on it
    // const { data: profile } = await supabase
    //   .from('profiles')
    //   .select('user_id, user_email')
    //   .eq('user_id', user.id)
    //   .maybeSingle();

    return noStoreJson({
      authenticated: true,
      email: user.email,
      userId: user.id,
      // profileExists: !!profile,
    });
  } catch (e: any) {
    return noStoreJson({ authenticated: false, error: String(e?.message || e) }, 200);
  }
}
