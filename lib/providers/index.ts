// lib/providers/index.ts
export async function submitClaimByProvider(provider: string, payload: any) {
  const p = provider?.toLowerCase?.() ?? "";

  if (p.includes("avanti")) {
    const { submitAvantiClaim } = await import("./avanti");
    return await submitAvantiClaim(payload);
  }

  if (p.includes("gwr") || p.includes("great western")) {
    const { submitGwrClaim } = await import("./gwr");
    return await submitGwrClaim(payload);
  }

  // ❌ No silent fallbacks in production
  return {
    ok: false,
    error: `Unsupported provider "${provider}"`,
    raw: { payload },
  };
}