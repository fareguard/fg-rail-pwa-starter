// app/(app)/dashboard/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import ConnectGmailButton from "@/app/components/ConnectGmailButton";
import TripsLive from "@/app/components/TripsLive"; // ✅ added import

type Me = {
  authenticated: boolean;
  email?: string;
  userId?: string;
  error?: string;
};

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<{ ok: boolean; claims?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // one place to (re)load data
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // never cache user state
      const r = await fetch("/api/me", { cache: "no-store" });
      const j: Me = await r.json();
      setMe(j);

      // lightweight sanity metric (also no-store)
      const s = await fetch("/dashboard/summary", { cache: "no-store" });
      const sj = await s.json();
      setSummary(sj);
    } catch (e: any) {
      setMe({ authenticated: false, error: String(e?.message || e) });
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  // 🔁 auto-refresh after OAuth completes (from /auth/callback/signing-in)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fg-auth-ok") {
        // cookie session is set; re-pull server state
        load();
      }
    };
    const onFocus = () => load();

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return (
    <div className="container section" style={{ paddingTop: 28 }}>
      <h1 className="h1" style={{ marginBottom: 6 }}>
        Your journeys & refund status
      </h1>
      <p className="sub">We’re watching your tickets and filing Delay Repay when eligible.</p>

      {loading && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="small">Loading your dashboard…</p>
        </div>
      )}

      {!loading && me && !me.authenticated && (
        <div className="card" style={{ marginTop: 16 }}>
          <span className="badge" style={{ marginBottom: 8 }}>Setup</span>
          <h3 style={{ margin: "6px 0 8px", color: "var(--fg-navy)" }}>
            Finish connecting Gmail
          </h3>
          <p className="small" style={{ marginBottom: 12 }}>
            Connect your Gmail (read-only) so we can detect e-tickets and file Delay Repay.
          </p>

          {/* ✅ 1-click connect here (redirects to /auth/callback/signing-in and bounces back) */}
          <ConnectGmailButton label="Connect Gmail (1–click)" className="btn btnPrimary" next="/dashboard" />

          {/* Optional: keep a fallback link just in case */}
          <p className="small" style={{ marginTop: 10 }}>
            Having trouble? <Link href="/?connect=1">Try from the homepage</Link>.
          </p>
        </div>
      )}

      {!loading && me && me.authenticated && (
        <div className="card" style={{ marginTop: 16 }}>
          <span
            className="badge"
            style={{ marginBottom: 8, background: "#ecf8f2", color: "var(--fg-green)" }}
          >
            Live
          </span>
          <h3 style={{ margin: "4px 0 8px", color: "var(--fg-navy)" }}>
            Welcome{me.email ? `, ${me.email}` : ""}.
          </h3>
          <p className="small">
            We’ll populate this list as your e-tickets are detected. Future trips show as “Queued”.
          </p>

          {summary?.ok && (
            <p className="small" style={{ marginTop: 8 }}>
              Claims in system: <strong>{summary.claims ?? 0}</strong>
            </p>
          )}

          {/* 👇 Added TripsLive under the authenticated card */}
          <TripsLive />
        </div>
      )}
    </div>
  );
}
