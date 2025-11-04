// app/(app)/dashboard/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import ConnectGmailButton from '@/app/components/ConnectGmailButton';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = false; // IMPORTANT: avoid the "[object Object]" error
export const fetchCache = 'force-no-store';

type Trip = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  operator: string | null;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  status: string | null;      // 'queued' | 'pending' | 'submitted' | 'paid' | etc.
  created_at: string;
  is_ticket?: boolean | null; // our heuristic flag
};

type Profile = {
  user_id: string;
  user_email: string | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load session & profile
  useEffect(() => {
    let unsub: (() => void) | null = null;

    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const session = sess?.session ?? null;
        setAuthReady(true);

        if (!session?.user?.id) {
          setConnected(false);
          setProfile(null);
          setTrips([]);
          setLoading(false);
          // subscribe to future login
          const { data: sub } = supabase.auth.onAuthStateChange((_evt, newSession) => {
            if (newSession?.user?.id) {
              // reload
              window.location.reload();
            }
          });
          unsub = () => sub.subscription.unsubscribe();
          return;
        }

        setConnected(true);

        // Fetch profile
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('user_id, user_email')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profErr) throw profErr;

        // If profile row doesn’t exist yet, create a minimal one on the fly
        let effectiveProfile: Profile | null = prof as any;
        if (!prof) {
          const email = session.user.email ?? null;
          const { data: ins, error: insErr } = await supabase
            .from('profiles')
            .insert({
              user_id: session.user.id,
              user_email: email,
            })
            .select('user_id, user_email')
            .maybeSingle();

          if (insErr) throw insErr;
          effectiveProfile = ins as any;
        }

        setProfile(effectiveProfile);

        // Fetch trips for this user
        const { data: tripRows, error: tripErr } = await supabase
          .from('trips')
          .select(
            'id, user_id, user_email, operator, origin, destination, depart_planned, arrive_planned, status, created_at, is_ticket'
          )
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(200);

        if (tripErr) throw tripErr;

        setTrips(tripRows ?? []);
      } catch (e: any) {
        setError(e?.message || 'Something went wrong.');
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Group trips into buckets for a cleaner UX
  const { future, pending, paid, other } = useMemo(() => {
    const f: Trip[] = [];
    const p: Trip[] = [];
    const d: Trip[] = [];
    const o: Trip[] = [];

    const now = Date.now();

    (trips ?? []).forEach((t) => {
      const departTs = t.depart_planned ? Date.parse(t.depart_planned) : NaN;
      const isFuture = !Number.isNaN(departTs) && departTs > now;

      if (isFuture) {
        f.push(t); // future => show as "Queued"
        return;
      }

      const st = (t.status || '').toLowerCase();
      if (st.includes('paid') || st.includes('approved')) {
        d.push(t);
      } else if (st.includes('pending') || st.includes('queued') || st.includes('submitted')) {
        p.push(t);
      } else {
        o.push(t);
      }
    });

    return { future: f, pending: p, paid: d, other: o };
  }, [trips]);

  // Small badge component
  const StatusBadge = ({ kind, children }: { kind: 'ok' | 'warn' | 'neutral'; children: any }) => {
    const styles =
      kind === 'ok'
        ? { bg: '#ecf8f2', color: 'var(--fg-green)', border: '#d6f0e4' }
        : kind === 'warn'
        ? { bg: '#ffecec', color: '#c62828', border: '#ffd7d7' }
        : { bg: '#f2f6fb', color: 'var(--fg-navy)', border: '#e6eef7' };

    return (
      <span
        className="badge"
        style={{ background: styles.bg, color: styles.color, borderColor: styles.border }}
      >
        {children}
      </span>
    );
  };

  const TripCard = ({ t }: { t: Trip }) => {
    const title = [t.origin, t.destination].filter(Boolean).join(' → ');
    const op = t.operator || '—';
    const st = (t.status || '').toLowerCase();

    let badge: JSX.Element | null = null;
    if (st.includes('paid') || st.includes('approved')) {
      badge = <StatusBadge kind="ok">Paid</StatusBadge>;
    } else if (st.includes('pending') || st.includes('submitted') || st.includes('queued')) {
      badge = <StatusBadge kind="neutral">{st.includes('queued') ? 'Queued' : 'Pending'}</StatusBadge>;
    } else {
      badge = <StatusBadge kind="neutral">Tracked</StatusBadge>;
    }

    return (
      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, color: 'var(--fg-navy)' }}>{title || 'Trip'}</div>
          {badge}
        </div>
        <div className="small">Operator: {op}</div>
        <div className="small">
          Depart: {t.depart_planned ? new Date(t.depart_planned).toLocaleString() : '—'}
        </div>
        <div className="small">
          Arrive: {t.arrive_planned ? new Date(t.arrive_planned).toLocaleString() : '—'}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Top nav (keeps your logo/header consistent with landing) */}
      <div className="nav">
        <div className="container navInner">
          <Link href="/" className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Image src="/media/logo.png" alt="FareGuard" width={140} height={28} priority />
          </Link>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link className="btn btnGhost" href="/how-it-works">How it works</Link>
            <Link className="btn btnGhost" href="/pricing">Pricing</Link>
            <Link className="btn btnGhost" href="/dashboard">Dashboard</Link>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ display: 'grid', gap: 14 }}>
          <div className="kicker">Dashboard</div>
          <h1 className="h1" style={{ marginTop: 0 }}>Your rail refunds, automated.</h1>

          {/* Connection state */}
          {!authReady || loading ? (
            <div className="card">
              <div className="small">Loading your account…</div>
            </div>
          ) : !connected ? (
            <div className="card" style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 800, color: 'var(--fg-navy)' }}>Connect your Gmail</div>
              <div className="small">
                We’ll scan for past e-tickets and start tracking new ones automatically.
              </div>
              <div><ConnectGmailButton label="Connect Gmail — free" /></div>
              <div className="small">Read-only. We only look for UK rail e-tickets.</div>
            </div>
          ) : (
            <>
              {/* Connected summary */}
              <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div className="small" style={{ marginBottom: 4, color: 'var(--fg-green)', fontWeight: 800 }}>
                    Connected
                  </div>
                  <div style={{ fontWeight: 800, color: 'var(--fg-navy)' }}>
                    {profile?.user_email || 'Your account'}
                  </div>
                </div>
                <div className="ctaRow">
                  <ConnectGmailButton label="Reconnect" />
                  <Link href="/search" className="btn btnGhost">Search tickets</Link>
                </div>
              </div>

              {/* Trips buckets */}
              {error && (
                <div className="card" style={{ borderColor: '#ffd7d7' }}>
                  <div className="small" style={{ color: '#c62828' }}>
                    {error}
                  </div>
                </div>
              )}

              {/* Future trips (Queued) */}
              <div className="section" style={{ padding: 0 }}>
                <h2>Future trips</h2>
                {future.length === 0 ? (
                  <div className="small">No future trips yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {future.map((t) => (
                      <TripCard key={t.id} t={{ ...t, status: 'queued' }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Pending / Submitted */}
              <div className="section" style={{ padding: 0 }}>
                <h2>Pending</h2>
                {pending.length === 0 ? (
                  <div className="small">Nothing pending right now.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {pending.map((t) => (
                      <TripCard key={t.id} t={t} />
                    ))}
                  </div>
                )}
              </div>

              {/* Paid / Approved */}
              <div className="section" style={{ padding: 0 }}>
                <h2>Paid</h2>
                {paid.length === 0 ? (
                  <div className="small">No paid refunds yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {paid.map((t) => (
                      <TripCard key={t.id} t={t} />
                    ))}
                  </div>
                )}
              </div>

              {/* Other / Tracked */}
              <div className="section" style={{ padding: 0 }}>
                <h2>All other trips</h2>
                {other.length === 0 ? (
                  <div className="small">No other trips yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {other.map((t) => (
                      <TripCard key={t.id} t={t} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
