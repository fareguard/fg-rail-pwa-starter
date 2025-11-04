'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

export default function DashboardClient() {
  const { data: me } = useSWR<{ email: string | null }>('/api/me', fetcher);
  const { data: tripsData } = useSWR<{ trips: Trip[] }>(
    me?.email ? '/api/trips' : null,
    fetcher
  );

  const email = me?.email ?? null;
  const trips = tripsData?.trips ?? [];

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
            Connect your Gmail (read-only) so we can detect e-tickets and file Delay Repay
            for eligible delays.
          </p>

          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              borderRadius: 10,
              fontWeight: 700,
              background: '#0F2A43',
              color: 'white',
              textDecoration: 'none',
              marginTop: 12,
            }}
          >
            Connect Gmail (1-click)
          </a>
        </div>
      </div>
    );
  }

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
          We’ll populate this list as we detect your e-tickets. Check back after your
          next booking.
        </p>
      </div>

      {/* Trips list */}
      {trips.length > 0 && (
        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          {trips.map((t) => {
            const title = [t.origin, '→', t.destination]
              .filter(Boolean)
              .join(' ')
              .trim();
            const badge =
              (t.status || '').toLowerCase().includes('pending') ||
              (t.status || '').toLowerCase().includes('queued')
                ? { label: 'Pending', bg: '#fff7e6', color: '#b36b00', border: '#ffe1b3' }
                : (t.status || '').toLowerCase().includes('submitted')
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
