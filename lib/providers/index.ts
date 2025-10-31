import { submitAvantiClaim } from "./avanti.auto";

// Add future providers here
// import { submitGWRClaim } from "./gwr.auto";
// import { submitWMTClaim } from "./wmt.auto";

export async function submitClaimByProvider(provider: string, payload: any) {
  switch (provider.toLowerCase()) {
    case "avanti":
      return submitAvantiClaim(payload);

    // Example placeholders for later:
    case "gwr":
      // return submitGWRClaim(payload);
      return { ok: false, error: "GWR not yet implemented" };

    case "wmt":
      // return submitWMTClaim(payload);
      return { ok: false, error: "WMT not yet implemented" };

    default:
      return { ok: false, error: `Unknown provider: ${provider}` };
  }
}
