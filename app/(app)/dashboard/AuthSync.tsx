"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthSync() {
  const router = useRouter();

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fg-auth-ok") {
        // Re-render server components to pick up the new auth session
        router.refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  return null;
}
