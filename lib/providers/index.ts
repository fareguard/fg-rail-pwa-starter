// lib/providers/index.ts
export async function submitClaimByProvider(provider: string, payload: any) {
  // Dynamically import only when needed — avoids Playwright build errors
  if (provider === "avanti") {
    const { submitAvantiClaim } = await import("./avanti");
    return await submitAvantiClaim(payload);
  }
  throw new Error(`No provider handler found for ${provider}`);
}
