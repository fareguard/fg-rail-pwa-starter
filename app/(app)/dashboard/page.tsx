// app/(app)/dashboard/page.tsx
'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// IMPORTANT: these must be numbers/strings, not objects.
export const revalidate = 0;               // do NOT use { revalidate: 0 }
export const dynamic = 'force-dynamic';    // keep this dynamic

function DashboardInner() {
  const search = useSearchParams();
  const [connected, setConnected] = useState<boolean>(false);

  // read ?connected=gmail from callback
  const connectedParam = useMemo(() => search.get('connected'), [search]);

  useEffect(() => {
    if (connectedParam === 'gmail') {
      setConnected(true);
    }
  }, [connectedParam]);

  // Fake example list to show states—replace with real data fetch later
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
          <span className="badge" title="Gmail connected">Gmail connected</span>
        ) : (
          <span className="badge" style={{ background:'#fff2f0', color:'#9b1c1c', borderColor:'#ffd9d4' }}>
            Gmail not connected
          </span>
        )}
      </div>

      {!connected ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', color: 'var(--fg-navy)' }}>Connect Gmail to start</h3>
          <p className="small">
            We auto-find rail e-tickets and file Delay Repay for you. Read-only, rail emails only.
          </p>
          <div className="ctaRow" style={{ marginTop: 10 }}>
            <Link href="/?cta=dashboard-connect#connect" className="btn btnPrimary">
              Connect Gmail
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', color: 'var(--fg-navy)' }}>You’re connected ✅</h3>
          <p className="small">
            We’re scanning your inbox for past trips and will auto-file eligible claims going forward.
          </p>
        </div>
      )}

      <section className="section" style={{ paddingTop: 0 }}>
        <h2>Trips</h2>
        <p className="small" style={{ marginBottom: 10 }}>
          Future trips show as <strong>Queued</strong>. Delays are flagged automatically.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {trips.map(t => {
            let chipStyle = { background:'#f5f8fb', color:'var(--fg-navy)', borderColor:'#e6eef7' };
            let chipText = 'Not delayed';

            if (t.status === 'queued') {
              chipStyle = { background:'#fff8e6', color:'#8a5800', borderColor:'#ffe1a6' } as any;
              chipText = 'Queued';
            } else if (t.status.startsWith('delayed_')) {
              chipStyle = { background:'#fff1f0', color:'#a8071a', borderColor:'#ffccc7' } as any;
              chipText = `Delayed by ${t.status.replace('delayed_', '')} mins`;
            }

            return (
              <div key={t.id} className="card">
                <div className="kicker">{t.id}</div>
                <h3 style={{ margin: '6px 0 6px', color: 'var(--fg-navy)', fontSize: 18 }}>{t.title}</h3>
                <div className="badge" style={{ ...chipStyle }}>{chipText}</div>
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
