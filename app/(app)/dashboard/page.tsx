// app/(app)/dashboard/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import ConnectGmailButton from "@/app/components/ConnectGmailButton";
import TripsLive from "@/components/TripsLive";
import RefreshIconButton from "@/app/components/RefreshIconButton";

type Me = {
  authenticated: boolean;
  email?: string;
  userId?: string;
  error?: string;
};

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ Welcome modal (first visit)
  const [showWelcome, setShowWelcome] = useState(false);

  // ✅ Account / kebab menu (for destructive actions)
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuPanelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const j: Me = await r.json();
      setMe(j);

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

  // 🔁 auto-refresh after OAuth completes
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fg-auth-ok") load();
    };
    const onFocus = () => load();

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // ✅ show welcome popup only on first visit (per browser)
  useEffect(() => {
    try {
      const key = "fg_welcome_seen";
      const seen = localStorage.getItem(key);
      if (!seen) {
        setShowWelcome(true);
        localStorage.setItem(key, "1");
      }
    } catch {
      // if localStorage is blocked, just don't show it
    }
  }, []);

  // ✅ close modal helpers
  const closeWelcome = useCallback(() => setShowWelcome(false), []);

  // ESC closes modal
  useEffect(() => {
    if (!showWelcome) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWelcome();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showWelcome, closeWelcome]);

  // ✅ Disconnect handler (reused by menu item)
  const disconnectAndDelete = useCallback(async () => {
    const ok = window.confirm("Disconnect FareGuard and delete all your data? This cannot be undone.");
    if (!ok) return;

    const r = await fetch("/api/disconnect", { method: "POST" });
    const j = (await r.json().catch(() => ({}))) as any;

    if (!r.ok) {
      // ✅ show detail if present
      const msg = j?.detail ? `${j?.error || "unknown_error"} — ${j.detail}` : j?.error || "unknown_error";
      alert("Disconnect failed: " + msg);
      return;
    }

    // optional: cleanup local flags
    try {
      localStorage.removeItem("fg-auth-ok");
    } catch {}

    window.location.href = "/";
  }, []);

  // ✅ Account menu close helper
  const closeAccountMenu = useCallback(() => setShowAccountMenu(false), []);

  // ✅ Close menu on outside click + ESC, restore focus to button
  useEffect(() => {
    if (!showAccountMenu) return;

    const onPointerDown = (e: PointerEvent) => {
      const btn = accountMenuBtnRef.current;
      const panel = accountMenuPanelRef.current;
      const t = e.target as Node | null;

      if (!t) return;
      if (btn?.contains(t)) return;
      if (panel?.contains(t)) return;

      closeAccountMenu();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAccountMenu();
        // restore focus
        accountMenuBtnRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAccountMenu, closeAccountMenu]);

  return (
    <div className="container section" style={{ paddingTop: 28 }}>
      {/* ✅ Welcome Modal */}
      {showWelcome && (
        <div
          role="presentation"
          onClick={(e) => {
            // click backdrop to close
            if (e.target === e.currentTarget) closeWelcome();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fgWelcomeTitle"
            style={{
              width: "min(560px, 100%)",
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <h2 id="fgWelcomeTitle" style={{ margin: 0, fontSize: "1.25rem" }}>
                Welcome to FareGuard!
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={closeWelcome}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "1.25rem",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <p style={{ margin: "12px 0" }}>
                FareGuard automatically tracks your e-tickets, monitors delays, and reminds you when you’re eligible for
                Delay Repay — so you never miss money you’re owed.
              </p>
              <p style={{ margin: "12px 0" }}>We’re continuously improving FareGuard with new features and updates.</p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" onClick={closeWelcome} className="btn btnPrimary" style={{ padding: "10px 14px" }}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 className="h1" style={{ marginBottom: 6, flex: "1 1 auto" }}>
          Your journeys & refund status
        </h1>
        <RefreshIconButton />
      </div>
      <p className="sub">We're tracking your tickets and checking for eligible delays.</p>

      {loading && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="small">Loading your dashboard…</p>
        </div>
      )}

      {!loading && me && !me.authenticated && (
        <div className="card" style={{ marginTop: 16 }}>
          <span className="badge" style={{ marginBottom: 8 }}>
            Setup
          </span>
          <h3 style={{ margin: "6px 0 8px", color: "var(--fg-navy)" }}>Finish connecting Gmail</h3>
          <p className="small" style={{ marginBottom: 12 }}>
            Connect your Gmail (read-only) so we can find your tickets and track delays automatically.
          </p>

          <ConnectGmailButton label="Connect Gmail (1–click)" className="btn btnPrimary" next="/dashboard" />

          <p className="small" style={{ marginTop: 10 }}>
            Having trouble? <Link href="/?connect=1">Try from the homepage</Link>.
          </p>
        </div>
      )}

      {!loading && me && me.authenticated && (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            {/* Header row: badge + kebab menu */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span className="badge" style={{ marginBottom: 8, background: "#ecf8f2", color: "var(--fg-green)" }}>
                Live
              </span>

              {/* Kebab menu trigger */}
              <div style={{ position: "relative" }}>
                <button
                  ref={accountMenuBtnRef}
                  type="button"
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={showAccountMenu}
                  onClick={() => setShowAccountMenu((v) => !v)}
                  className="btn"
                  style={{
                    padding: "6px 10px",
                    fontSize: 18,
                    lineHeight: 1,
                    background: "transparent",
                    border: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  ⋯
                </button>

                {showAccountMenu && (
                  <div
                    ref={accountMenuPanelRef}
                    role="menu"
                    aria-label="Account actions"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 8px)",
                      width: 240,
                      background: "#fff",
                      border: "1px solid rgba(0,0,0,0.10)",
                      borderRadius: 12,
                      boxShadow: "0 14px 34px rgba(0,0,0,0.18)",
                      padding: 8,
                      zIndex: 50,
                    }}
                  >
                    {/* Placeholder for future items */}
                    <div
                      style={{
                        padding: "8px 10px",
                        fontSize: 12,
                        color: "rgba(0,0,0,0.55)",
                      }}
                    >
                      Account
                    </div>

                    <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "6px 0" }} />

                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        closeAccountMenu();
                        await disconnectAndDelete();
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid rgba(239,68,68,0.22)",
                        background: "rgba(239,68,68,0.08)",
                        color: "#b91c1c",
                        borderRadius: 10,
                        padding: "10px 10px",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      Disconnect & delete data
                    </button>

                    <div style={{ padding: "8px 10px", fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                      This will remove access and delete your stored data.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <h3 style={{ margin: "4px 0 8px", color: "var(--fg-navy)" }}>
              Welcome{me.email ? `, ${me.email}` : ""}.
            </h3>
            <p className="small">We’ll populate this list as your e-tickets are detected. Future trips show as “Queued”.</p>


          <TripsLive />
        </>
      )}
    </div>
  );
}
