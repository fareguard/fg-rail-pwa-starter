"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SigningInPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  useEffect(() => {
    // Let other tabs/pages know auth completed
    try { localStorage.setItem("fg-auth-ok", String(Date.now())); } catch {}

    // Small delay ensures the storage event fires & cookies settle
    const t = setTimeout(() => router.replace(next), 500);
    return () => clearTimeout(t);
  }, [next, router]);

  return (
    <main className="container" style={{ padding: "64px 16px" }}>
      <h1 className="h1">Signing you in…</h1>
      <p className="sub">One moment while we complete your setup.</p>
      <p className="small" style={{ marginTop: 12 }}>
        If nothing happens, <a href={next}>continue to your dashboard</a>.
      </p>
    </main>
  );
}
