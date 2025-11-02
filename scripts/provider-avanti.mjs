// scripts/provider-avanti.mjs
import { chromium } from "@playwright/test";

export async function submitAvantiClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  // small helper
  const safeClick = async (loc) => {
    try { if (await loc.count()) await loc.first().click({ timeout: 15000 }); } catch {}
  };

  try {
    // Go straight to Avanti Delay Repay login (skips marketing page flicker)
    await page.goto("https://delayrepay.avantiwestcoast.co.uk/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Kill TrustArc / cookie overlays if present
    await page.addStyleTag({ content: `
      #truste-consent-track, .truste_overlay, [id^="truste_"], [id^="pop-div"] {
        display: none !important; visibility: hidden !important; pointer-events:none !important;
      }
    `});
    // Also try common accept buttons (sometimes in iframes)
    await safeClick(page.locator('button:has-text("Accept All"), button:has-text("I Accept"), button:has-text("Agree")'));

    // If we got routed somewhere else, try to find a CTA
    const startCta = page.locator('a:has-text("Delay Repay"), a:has-text("Start"), a[href*="delayrepay"]');
    if (await startCta.count()) {
      await safeClick(startCta);
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    }

    // Pull from payload
    const email = payload.user_email || "hello@fareguard.co.uk";
    const ref = payload.booking_ref || "UNKNOWN";
    const origin = payload.origin || "Wolverhampton";
    const destination = payload.destination || "Birmingham New Street";
    const dep = payload.depart_planned
      ? new Date(payload.depart_planned).toLocaleString("en-GB", { timeZone: "Europe/London" })
      : "";
    const arr = payload.arrive_planned
      ? new Date(payload.arrive_planned).toLocaleString("en-GB", { timeZone: "Europe/London" })
      : "";
    const delay = payload.delay_minutes ?? "";

    // Helper to fill by label or selector
    const tryFill = async (selectorOrLabelRegex, value) => {
      if (!value) return;
      try {
        if (selectorOrLabelRegex instanceof RegExp) {
          const ctl = page.getByLabel(selectorOrLabelRegex);
          if (await ctl.count()) return ctl.first().fill(String(value), { timeout: 10000 });
        } else {
          const ctl = page.locator(selectorOrLabelRegex);
          if (await ctl.count()) return ctl.first().fill(String(value), { timeout: 10000 });
        }
      } catch {}
    };

    // Try common fields (their DOM can vary)
    await tryFill(/Booking\s*reference/i, ref);
    await tryFill(/Email/i, email);
    await tryFill('input[name*="booking"]', ref);
    await tryFill('input[type="email"]', email);

    // Free text / notes
    const notes = page.locator("textarea, [name*='journey']");
    if (await notes.count()) {
      await notes.first().fill(
        `${origin} → ${destination}\nDepart: ${dep}\nArrive: ${arr}\nDelay approx: ${delay} mins`,
        { timeout: 10000 }
      );
    }

    // Screenshot before submit
    await page.screenshot({ path: "avanti_before.png", fullPage: true });

    // Only submit if we’ve explicitly enabled it
    if (submitLive) {
      const submitBtn = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Continue")'
      );
      await safeClick(submitBtn);
      // give it time to navigate/confirm
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    }

    await page.screenshot({ path: "avanti_after.png", fullPage: true });
    await browser.close();

    return {
      ok: true,
      provider: "avanti",
      submitted_at: new Date().toISOString(),
      provider_ref: null,
      screenshots: { before: "avanti_before.png", after: "avanti_after.png" },
      payload,
    };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "avanti", payload };
  }
}