/* lib/providers/index.ts */
import { submitAvantiClaim } from "./avanti";

export async function submitClaimByProvider(provider: string, payload: any) {
  const p = (provider || "").toLowerCase();
  if (p === "avanti") return submitAvantiClaim(payload);
  // add more providers here: wmt, gwr, lner, xc, tl, etc.
  return { ok: false, submitted_at: new Date().toISOString(), raw: { error: "Unknown provider" } };
}
