// app/(app)/dashboard/page.tsx
'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// Force this page to be dynamic and NEVER prerender/ISR
export const dynamic = 'force-dynamic';
export const revalidate = false as const; // number or false ONLY (not an object)

function DashboardInner() {
  const search = useSearchParams();
  const [connected, setConnected] = useState(false);

  const connectedParam = useMemo(() => search.get('connected'), [search]);

  useEffect(() => {
    if (connectedParam === 'gmail') setConnected(true);
  }, [connectedParam]);

  const trips = [
    { id: 'T-1', title: 'Wolverhampton → Birmingham', status: 'queued', eta: '10 Nov', potential: '£8–£20' },
    { id: 'T-2', title: 'Birmingham → London Euston', status: 'not_delayed', eta: '—', potential: '—' },
    { id: 'T-3', title: 'London Euston → Birmingham', status: 'delayed_34', eta: 'Processed', potential: '£12.40' },
  ];

  return (
    <div className="container" style={{ paddingTop: 28, paddingBottom: 48 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Dashboard</h1>
        {connected ? (
          <span className="badge">Gmail connected</span>
        ) : (
          <span className="badge" style={{ background:'#fff2f0', color:'#9b1c1c', borderColor:'#ffd9d4' }}>
            Gmail not connected
          </span>
        )}
      </div>

      {!connected ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', color: 'var(--fg-navy)' }}>Connect Gmail to start</h3>
          <p className="small">Read-only, rail emails only.</p>
          <div className="ctaRow" style={{ marginTop: 10 }}>
            <Link href="/?cta=dashboard-connect#connect" className="btn btnPrimary">Connect Gmail</Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', color: 'var(--fg-navy)' }}>You’re connected ✅</h3>
          <p className="small">We’re scanning your inbox for past trips and will auto-file claims going forward.</p>
        </div>
      )}

      <section className="section" style={{ paddingTop: 0 }}>
        <h2>Trips</h2>
        <p className="small" style={{ marginBottom: 10 }}>
          Future trips show as <strong>Queued</strong>. Delays are flagged automatically.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {trips.map(t => {
            let chipStyle: React.CSSProperties = { background:'#f5f8fb', color:'var(--fg-navy)', border:'1px solid #e6eef7' };
            let chipText = 'Not delayed';

            if (t.status === 'queued') {
              chipStyle = { background:'#fff8e6', color:'#8a5800', border:'1px solid #ffe1a6' };
              chipText = 'Queued';
            } else if (t.status.startsWith('delayed_')) {
              chipStyle = { background:'#fff1f0', color:'#a8071a', border:'1px solid #ffccc7' };
              chipText = `Delayed by ${t.status.replace('delayed_', '')} mins`;
            }

            return (
              <div key={t.id} className="card">
                <div className="kicker">{t.id}</div>
                <h3 style={{ margin: '6px 0 6px', color: 'var(--fg-navy)', fontSize: 18 }}>{t.title}</h3>
                <span className="badge" style={chipStyle}>{chipText}</span>
                <ul className="list">
                  <li><span className="dot" /><span><strong>Potential:</strong> {t.potential}</span></li>
                  <li><span className="dot" /><span><strong>ETA:</strong> {t.eta}</span></li>
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="container" style={{ paddingTop: 28 }}>Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}
