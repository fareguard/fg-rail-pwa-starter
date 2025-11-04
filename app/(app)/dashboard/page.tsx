// app/(app)/dashboard/page.tsx
'use client';

import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-dynamic';
export const revalidate = false;
export const fetchCache = 'force-no-store';

export default function DashboardSmokeTest() {
  return (
    <>
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
        <div className="container">
          <h1 className="h1" style={{ marginTop: 0 }}>Dashboard (smoke test)</h1>
          <p className="small">If you can see this, the route renders client-side correctly.</p>
        </div>
      </section>
    </>
  );
}
