'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import ConnectGmailButton from '@/app/components/ConnectGmailButton';

type Trip = {
  id: string;
  origin: string | null;
  destination: string | null;
  operator: string | null;
  retailer: string | null;
  booking_ref: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  is_ticket: boolean | null;
  status: string | null;
  created_at: string | null;
};

export default function Dashboard() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [trips, setTrips] = useState<Trip[] | null>(null);

  async function loadMeAndTrips() {
    try {
      const me = await fetch('/api/me', { cache: 'no-store' }).then(r => r.json());
      setEmail(me?.email ?? null);

      if (me?.email) {
        const t = await fetch('/api/trips', { cache: 'no-store' }).then(r => r.json());
        setTrips(t?.trips ?? []);
      } else {
        setTrips([]);
      }
    } catch {
      setEmail(null);
      setTrips([]);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      await loadMeAndTrips();
    })();

    // Refresh when auth state changes (after Google redirect)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      if (!alive) return;
      loadMeAndTrips();
    });

    // Also refresh when tab gains focus
    const onFocus = () => loadMeAndTrips();
    window.addEventListener('focus', onFocus);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const header = (
    <div style={{ padding: '24px 24px 0' }}>
      <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.1 }}>
        Your journeys & refund status
      </h1>
      <p style={{ color: '#5b6b80', marginTop: 8 }}>
        We’re watching your tickets and filing Delay Repay when eligible.
      </p>
    </div>
  );

  // Loading state
  if (email === undefined) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <p style={{ color: '#5b6b80', marginTop: 16 }}>Loading…</p>
      </div>
    );
  }

  // Not connected → show real Connect button (no redirect back to landing)
  if (!email) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <div
          style={{
            marginTop: 16,
            border: '1px solid #eef1f5',
            borderRadius: 16,
            padding: 20,
            boxShadow: '0 4px 16px rgba(15,42,67,0.05)',
          }}
        >
          <div
            style={{
              background: '#ecf8f2',
              color: '#18A05E',
              display: 'inline-block',
              padding: '6px 10px',
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 12,
              border: '1px solid #d6f0e4',
            }}
          >
            Setup
          </div>

          <h3 style={{ margin: '10px 0 8px' }}>Finish connecting Gmail</h3>
          <p style={{ color: '#5b6b80', marginTop: 6 }}>
            Connect your Gmail (read-only) so we can detect e-tickets and file Delay Repay.
          </p>

          <ConnectGmailButton />
        </div>
      </div>
    );
  }

  // Connected
  return (
    <div style={{ padding: 24 }}>
      {header}

      <div
        style={{
          marginTop: 16,
          border: '1px solid #eef1f5',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 4px 16px rgba(15,42,67,0.05)',
        }}
      >
        <div
          style={{
            background: '#ecf8f2',
            color: '#18A05E',
            display: 'inline-block',
            padding: '6px 10px',
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 12,
            border: '1px solid #d6f0e4',
          }}
        >
          Live
        </div>

        <h3 style={{ margin: '10px 0 8px' }}>Setup complete</h3>
        <p style={{ color: '#5b6b80', marginTop: 6 }}>
          We’ll populate this list as we detect your e-tickets. Check back after your next
          booking.
        </p>
      </div>

      {trips && trips.length > 0 && (
        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          {trips.map((t) => {
            const title = [t.origin, '→', t.destination].filter(Boolean).join(' ').trim();
            const lower = (t.status || '').toLowerCase();
            const badge =
              lower.includes('pending') || lower.includes('queued')
                ? { label: 'Pending', bg: '#fff7e6', color: '#b36b00', border: '#ffe1b3' }
                : lower.includes('submitted')
                ? { label: 'Submitted', bg: '#ecf8f2', color: '#18A05E', border: '#d6f0e4' }
                : { label: t.status || '—', bg: '#f5f8fb', color: '#0F2A43', border: '#e6eef7' };

            return (
              <div
                key={t.id}
                style={{
                  border: '1px solid #eef1f5',
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{title || 'Trip'}</div>
                  <div style={{ color: '#5b6b80', fontSize: 14, marginTop: 4 }}>
                    {t.operator || 'Operator'} • {t.booking_ref || '—'}
                  </div>
                </div>
                <div
                  style={{
                    background: badge.bg,
                    color: badge.color,
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: `1px solid ${badge.border}`,
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {badge.label}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
