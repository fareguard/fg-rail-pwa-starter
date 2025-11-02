// scripts/providers/avanti.ts
// ESM module – matches the rest of the providers folder pattern.
// Purpose: open Avanti Delay Repay reliably (kills cookie overlays), then return screenshots.
// You can wire real form submission later; this unblocks the click timeout.

import { chromium, Page } from "playwright";

type ProviderPayload = {
  user_email?: string | null;
  booking_ref?: string | null;
  origin?: string | null;
  destination?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
};

export async function killOverlays(page: Page) {
  try {
    const accept = page.locator(
      'button:has-text("Accept All"), button:has-text("I Agree"), #truste-consent-button, #onetrust-accept-btn-handler'
    );
    if (await accept.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await accept.first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.addStyleTag({
      content: `
        #truste_overlay, .truste_overlay, #onetrust-banner-sdk, .ot-sdk-row, .ot-sdk-container {
          pointer-events:none !important; opacity:0 !important; display:none !important;
        }
      `,
    });
  } catch {}
}

async function clickDelayRepay(page: Page) {
  const link = page
    .locator('a:has-text("Delay Repay"), a:has-text("Start"), a[href*="delayrepay"]')
    .first();
  await link.waitFor({ timeout: 15000 });
  await link.scrollIntoViewIfNeeded();
  // prime element
  await link.click({ trial: true }).catch(() => {});
  await link.click({ timeout: 5000 });
}

export default async function run(payload: ProviderPayload) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const screenshots: Record<string, string> = {};
  try {
    // Go to Avanti site then click through to Delay Repay
    await page.goto("https://www.avantiwestcoast.co.uk/", { waitUntil: "load", timeout: 60000 });
    await killOverlays(page);

    await page.screenshot({ path: "avanti_before.png", fullPage: true }).catch(() => {});
    screenshots.before = "avanti_before.png";

    // Try direct link first (faster), fall back to menu link
    try {
      await page.goto("https://delayrepay.avantiwestcoast.co.uk/en/login", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch {
      await clickDelayRepay(page);
    }

    await killOverlays(page);
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });

    await page.screenshot({ path: "avanti_after.png", fullPage: true }).catch(() => {});
    screenshots.after = "avanti_after.png";

    // We’re not actually submitting yet; just confirm we reached the portal.
    const onPortal = await page
      .locator('text=/Delay Repay|Sign in|Login/i')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => true);

    await browser.close();
    return {
      ok: !!onPortal,
      provider: "avanti",
      provider_ref: null,
      screenshots,
      error: onPortal ? null : "Could not reach Delay Repay portal",
    };
  } catch (e: any) {
    await browser.close();
    return {
      ok: false,
      provider: "avanti",
      provider_ref: null,
      screenshots,
      error: e?.message || String(e),
    };
  }
}
