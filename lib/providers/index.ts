// lib/providers/index.ts

export async function submitClaimByProvider(provider: string, payload: any) {
  const p = (provider || "").toLowerCase();

  if (p === "avanti") {
    // Load Playwright-based module only when allowed (e.g. local dev)
    if (process.env.PLAYWRIGHT_ENABLED === "true") {
      try {
        const mod = await import("./avanti.auto"); // dynamic import at runtime
        return mod.submitAvantiClaim(payload);
      } catch (err: any) {
        return { ok: false, error: `Failed to load avanti.auto: ${err.message || err}` };
      }
    }

    // Stub: production-safe response (no Playwright)
    return {
      ok: true,
      submitted_at: new Date().toISOString(),
      provider: "avanti",
      provider_ref: null,
      raw: { note: "Playwright disabled in production" },
    };
  }

  return { ok: false, error: `Unknown provider: ${provider}` };
}
