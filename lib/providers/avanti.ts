/* lib/providers/avanti.ts */
type SubmitInput = {
  user_email: string | null;
  booking_ref: string | null;
  operator: string | null;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  delay_minutes?: number | null;
};

export async function submitAvantiClaim(
  payload: SubmitInput
): Promise<{ ok: boolean; submitted_at: string; provider_ref?: string; raw?: any }> {
  // MVP: return a fake provider reference; swap this with Playwright later.
  // When you’re ready, uncomment the Playwright flow and implement the form fill.

  // Example (later):
  // const { chromium } = await import("@playwright/test");
  // const browser = await chromium.launch();
  // const page = await browser.newPage();
  // await page.goto("https://www.avantiwestcoast.co.uk/help-and-support/delay-repay");
  // ... fill fields with payload ...
  // const ref = await page.locator("text=Reference").textContent();
  // await browser.close();

  const submitted_at = new Date().toISOString();
  const provider_ref = `AV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return { ok: true, submitted_at, provider_ref, raw: { payload } };
}
