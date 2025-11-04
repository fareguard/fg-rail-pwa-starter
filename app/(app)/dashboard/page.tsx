'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import ConnectGmailButton from '@/app/components/ConnectGmailButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Me =
  | { authed: false }
  | {
      authed: true;
      user: { id: string; email: string };
      profile?: { gmail_connected?: boolean | null };
    };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      const data = (await res.json()) as Me;
      setMe(data);
    } catch {
      setMe({ authed: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
    // also auto-refresh once after OAuth redirect (?code=…)
    const url = new URL(window.location.href);
    if (url.searchParams.has('code')) {
      // clean the URL and refresh state once
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url.toString());
      setTimeout(loadMe, 800);
    }
  }, [loadMe]);

  // --- UI blocks (match your current styling) ---
  const Title = () => (
    <div className="container" style={{ maxWidth: 1120, padding: '32px 20px' }}>
      <h1 className="h1" style={{ marginBottom: 8 }}>
        Your journeys & refund status
      </h1>
      <p className="sub">We’re watching your tickets and filing Delay Repay when eligible.</p>
    </div>
  );

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="container" style={{ maxWidth: 1120, padding: '12px 20px 48px' }}>
      <div className="card">
        {children}
      </div>
    </div>
  );

  if (loading) {
    return (
      <>
        <Title />
        <Card>
          <div className="badge">Loading</div>
          <h3 style={{ margin: '10px 0 6px', color: 'var(--fg-navy)' }}>Checking your account…</h3>
          <p className="small">Hold tight, just a sec.</p>
        </Card>
      </>
    );
  }

  // Not signed in at all → nudge to home to start
  if (!me || me.authed === false) {
    return (
      <>
        <Title />
        <Card>
          <div className="badge">Setup</div>
          <h3 style={{ margin: '10px 0 6px', color: 'var(--fg-navy)' }}>Sign in to view your dashboard</h3>
          <p className="small">Start from the home page to connect your Gmail and come back here.</p>
          <div className="ctaRow" style={{ marginTop: 14 }}>
            <Link href="/" className="btn btnPrimary">Go to home</Link>
          </div>
        </Card>
      </>
    );
  }

  const gmailConnected = Boolean(me.profile?.gmail_connected);

  // Signed in but Gmail not connected yet
  if (!gmailConnected) {
    return (
      <>
        <Title />
        <Card>
          <div className="badge">Setup</div>
          <h3 style={{ margin: '10px 0 6px', color: 'var(--fg-navy)' }}>Finish connecting Gmail</h3>
          <p className="small">
            Connect your Gmail (read-only) so we can detect e-tickets and file Delay Repay.
          </p>
          <div className="ctaRow" style={{ marginTop: 14 }}>
            <ConnectGmailButton label="Connect Gmail (1–click)" next="/dashboard" />
          </div>
        </Card>
      </>
    );
  }

  // Fully connected — show the “live” empty state for now
  return (
    <>
      <Title />
      <Card>
        <div className="badge" style={{ background:'#ecf8f2', color:'var(--fg-green)' }}>Live</div>
        <h3 style={{ margin: '10px 0 6px', color: 'var(--fg-navy)' }}>Setup complete</h3>
        <p className="small">
          We’ll populate this list as we detect your e-tickets. Check back after your next booking.
        </p>
        {/* You can render real trips here later */}
      </Card>
    </>
  );
}
