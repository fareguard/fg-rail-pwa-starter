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

    const email = payload.user_email;
    const ref = payload.booking_ref;

    if (!email) return { ok: false, error: "missing_user_email", provider: "wmt" };
    if (!ref) return { ok: false, error: "missing_booking_ref", provider: "wmt" };

    await page.fill('input[type="email"], input[name*="email"]', email);
    await page.fill('input[name*="booking"], input[name*="reference"]', ref);

    if (!submitLive) {
      await browser.close();
      return { ok: true, dry_run: true, provider: "wmt" };
    }

    const submitBtn = page.locator('button[type="submit"], input[type="submit"]');
    if (!(await submitBtn.count())) return { ok: false, error: "submit_button_not_found", provider: "wmt" };

    await submitBtn.first().click();

    // Confirmation heuristic (you must tune this after one real submit)
    await page.waitForLoadState("domcontentloaded");
    const confirmation = page.locator('text=/reference|submitted|thank you|confirmation/i');

    if (await confirmation.count()) {
      const txt = (await confirmation.first().innerText().catch(() => "")) || "";
      await browser.close();
      return { ok: true, provider: "wmt", provider_ref: null, confirmation_text: txt.slice(0, 500) };
    }

    // If no confirmation, fail (prevents false "submitted")
    await browser.close();
    return { ok: false, error: "no_confirmation_detected", provider: "wmt" };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "wmt" };
  }
}
