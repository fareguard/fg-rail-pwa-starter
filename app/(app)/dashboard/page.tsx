// app/(app)/dashboard/page.tsx
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ConnectGmailButton from "@/app/components/ConnectGmailButton";

// ✅ Make sure this page is never prerendered
export const dynamic = "force-dynamic";
// ✅ Valid values: number or false. Use false to fully disable ISR on this page.
export const revalidate = false;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DashboardPage() {
  return (
    <div className="container" style={{ padding: "40px 0" }}>
      <Suspense fallback={<div>Loading…</div>}>
        <DashboardInner />
      </Suspense>
    </div>
  );
}

type Profile = {
  user_id: string;
  user_email: string | null;
  gmail_connected?: boolean | null;
};

function DashboardInner() {
  const params = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState<null | {
    id: string;
    email: string | null;
  }>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // 1) Current auth session
      const { data: ses } = await supabase.auth.getSession();
      const user = ses.session?.user
        ? { id: ses.session.user.id, email: ses.session.user.email ?? null }
        : null;
      setSessionUser(user);

      // 2) If back from OAuth (?auth=1), mark profile as connected
      if (user && params.get("auth") === "1") {
        await supabase
          .from("profiles")
          .upsert(
            {
              user_id: user.id,
              user_email: user.email,
              gmail_connected: true,
            },
            { onConflict: "user_id" }
          );
      }

      // 3) Fetch latest profile
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (prof) setProfile(prof as Profile);
      }

      setLoading(false);
    })();
  }, [params]);

  if (loading) {
    return (
      <>
        <h1 className="h1">Your journeys & refund status</h1>
        <p className="sub">Loading…</p>
      </>
    );
  }

  if (!sessionUser) {
    return (
      <>
        <h1 className="h1">Your journeys & refund status</h1>
        <p className="sub">Connect Gmail to start tracking your e-tickets.</p>
        <div className="ctaRow">
          <ConnectGmailButton />
        </div>
      </>
    );
  }

  const connected = !!profile?.gmail_connected;

  return (
    <>
      <h1 className="h1">Your journeys & refund status</h1>

      {!connected ? (
        <>
          <p className="sub" style={{ marginTop: 8 }}>
            You’re signed in as {sessionUser.email}. Connect Gmail so we can
            find your rail e-tickets.
          </p>
          <div className="ctaRow">
            <ConnectGmailButton label="Connect Gmail" />
          </div>
        </>
      ) : (
        <div className="badge" style={{ marginTop: 8 }}>
          Connected to Gmail ✅
        </div>
      )}

      {/* TODO: render journeys / claims list here */}
    </>
  );
}
