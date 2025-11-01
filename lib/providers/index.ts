// lib/providers/index.ts

export async function submitClaimByProvider(provider: string, payload: any) {
  // Normalize provider string
  const p = provider?.toLowerCase?.() ?? "";

  // ✅ Dynamically import only when needed — avoids Playwright build errors
  if (p.includes("avanti") || p === "avanti west coast") {
    const { submitAvantiClaim } = await import("./avanti");
    return await submitAvantiClaim(payload);
  }

  // ✅ fallback to Avanti for now (until we add WMT, GWR, etc.)
  console.warn(`Unknown provider "${provider}", defaulting to Avanti West Coast`);
  const { submitAvantiClaim } = await import("./avanti");
  return await submitAvantiClaim(payload);
}
