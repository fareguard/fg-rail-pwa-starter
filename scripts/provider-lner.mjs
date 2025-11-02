// scripts/provider-lner.mjs
import { chromium } from "@playwright/test";

export async function submitLNERClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto("https://delayrepay.lner.co.uk/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const cookieBtn = page.locator('button:has-text("Accept")');
    if (await cookieBtn.count()) await cookieBtn.click();

    const startBtn = page.locator('a:has-text("Make a claim")');
    if (await startBtn.count()) {
      await startBtn.first().click();
      await page.waitForLoadState("domcontentloaded");
    }

    const email = payload.user_email || "hello@fareguard.co.uk";
    const ref = payload.booking_ref || "UNKNOWN";

    await page.fill('input[name*="email"]', email);
    await page.fill('input[name*="booking"], input[name*="ref"]', ref);

    if (submitLive) {
      const submitBtn = page.locator('button[type="submit"], input[type="submit"]');
      if (await submitBtn.count()) {
        await submitBtn.first().click();
        await page.waitForLoadState("networkidle");
      }
    }

    await browser.close();
    return { ok: true, provider: "lner", submitted_at: new Date().toISOString(), payload };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "lner", payload };
  }
}
