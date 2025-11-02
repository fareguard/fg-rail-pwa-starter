// scripts/provider-gwr.mjs
import { chromium } from "@playwright/test";

export async function submitGWRClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto("https://delayrepay.gwr.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const cookieBtn = page.locator('button:has-text("Accept")');
    if (await cookieBtn.count()) await cookieBtn.click();

    const guestBtn = page.locator('button:has-text("Continue as Guest")');
    if (await guestBtn.count()) {
      await guestBtn.click();
      await page.waitForLoadState("domcontentloaded");
    }

    const email = payload.user_email || "hello@fareguard.co.uk";
    const ref = payload.booking_ref || "UNKNOWN";

    await page.fill('input[type="email"]', email);
    await page.fill('input[name*="booking"], input[name*="reference"]', ref);

    if (submitLive) {
      const submitBtn = page.locator('button[type="submit"], input[type="submit"]');
      if (await submitBtn.count()) {
        await submitBtn.first().click();
        await page.waitForLoadState("networkidle");
      }
    }

    await browser.close();
    return { ok: true, provider: "gwr", submitted_at: new Date().toISOString(), payload };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "gwr", payload };
  }
}
