// scripts/provider-wmt.mjs
import { chromium } from "@playwright/test";

export async function submitWMTClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto("https://delayrepay.londonnorthwesternrailway.co.uk/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Agree")');
    if (await cookieBtn.count()) await cookieBtn.first().click();

    const startBtn = page.locator('a:has-text("Start"), a:has-text("Delay Repay")');
    if (await startBtn.count()) {
      await startBtn.first().click();
      await page.waitForLoadState("domcontentloaded");
    }

    const email = payload.user_email || "hello@fareguard.co.uk";
    const ref = payload.booking_ref || "UNKNOWN";

    await page.fill('input[type="email"], input[name*="email"]', email);
    await page.fill('input[name*="booking"], input[name*="reference"]', ref);

    if (submitLive) {
      const submitBtn = page.locator('button[type="submit"], input[type="submit"]');
      if (await submitBtn.count()) {
        await submitBtn.first().click();
        await page.waitForLoadState("networkidle");
      }
    }

    await browser.close();
    return { ok: true, provider: "wmt", submitted_at: new Date().toISOString(), payload };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "wmt", payload };
  }
}
