'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

export default function SessionWatcher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    // 1) Refresh this page when auth state changes in this tab
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      router.refresh();
      try {
        localStorage.setItem('fg:auth-changed', String(Date.now()));
      } catch {}
    });

    // 2) Refresh when another tab signals auth change (e.g., after OAuth redirect)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'fg:auth-changed') router.refresh();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [router]);

  return null; // nothing to render
}
