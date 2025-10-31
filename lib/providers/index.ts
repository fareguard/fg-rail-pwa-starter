// lib/providers/index.ts

export async function submitClaimByProvider(provider: string, payload: any) {
  const p = (provider || "").toLowerCase();

  if (p === "avanti") {
    // Only load Playwright code when explicitly enabled (local / worker box)
    if (process.env.PLAYWRIGHT_ENABLED === "true") {
      try {
        const mod = await import("./avanti.auto"); // loaded at runtime, not build-time
        return mod.submitAvantiClaim(payload);
      } catch (e: any) {
        return { ok: false, error: `Failed to load avanti.auto: ${e?.message || e}` };
      }
    }
    // Production-safe stub (so serverless build doesn’t need playwright)
    return {
      ok: true,
      submitted_at: new Date().toISOString(),
      provider: "avanti",
      provider_ref: null,
      raw: { note: "Playwright disabled; submission stub" },
    };
  }

  // TODO: add more providers (gwr/wmt/etc) here, behind the same guard
  return { ok: false, error: `Unknown provider: ${provider}` };
}
