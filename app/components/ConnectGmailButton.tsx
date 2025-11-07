// app/components/ConnectGmailButton.tsx
"use client";

import { useState, useCallback } from "react";

export default function ConnectGmailButton({
  label = "Connect Gmail (1–click)",
  next = "/dashboard",
  className = "btn btnPrimary",
}: {
  label?: string;
  next?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    try {
      setBusy(true);
      const origin =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_SITE_URL || "";

      // Hit our Google OAuth starter (this issues refresh_token properly)
      const url = `${origin}/api/auth/google/start?next=${encodeURIComponent(
        next
      )}`;
      window.location.href = url;
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  }, [next]);

  return (
    <button onClick={onClick} className={className} disabled={busy}>
      {busy ? "Opening Google…" : label}
    </button>
  );
}
