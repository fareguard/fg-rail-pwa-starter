// scripts/provider-avanti.mjs
import { chromium } from "@playwright/test";

// Kill TrustArc / OneTrust overlays that block clicks
async function dismissCookies(page) {
  // Try the obvious “Accept” buttons first
  const selectors = [
    "#truste-consent-button",
    ".truste_button_accept",
    "a.truste_button_2",
    "#onetrust-accept-btn-handler",
    'button[title="Accept All"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel);
      if (await loc.count()) {
        await loc.first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
        break;
      }
    } catch {}
  }

  // As a safety net, remove common overlay elements entirely
  await page
    .evaluate(() => {
      const kill = (q) => document.querySelectorAll(q).forEach((n) => n.remove());
      kill(".truste_cm_outerdiv");
      kill(".truste_box_overlay_border");
      kill("#onetrust-banner-sdk");
      kill(".ot-sdk-container");
    })
    .catch(() => {});
}

export async function submitAvantiClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Minimal hardening for flaky marketing redirects
    await page.goto("https://www.avantiwestcoast.co.uk/help-and-support/delay-repay", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // NEW: clear cookie/consent overlays so clicks aren’t intercepted
    await dismissCookies(page);

    // Try to find a “Start claim” or similar CTA
    const start = page.locator(
      'a:has-text("Delay Repay"), a:has-text("Start"), a[href*="delay-repay"]'
    );

    // Give the CTA a moment to render after consent changes
    await start.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await start.count()) {
      // Retry click once if something still intercepts pointer events
      try {
        await start.first().click({ timeout: 30000 });
      } catch {
        await dismissCookies(page);
        await start.first().click({ timeout: 30000 });
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    }

    // Basic fields from payload
    const email = payload.user_email || "hello@fareguard.co.uk";
    const ref = payload.booking_ref || "UNKNOWN";
    const origin = payload.origin || "Wolverhampton";
    const destination = payload.destination || "Birmingham New Street";
    const dep = payload.depart_planned
      ? new Date(payload.depart_planned).toLocaleString("en-GB", { timeZone: "Europe/London" })
      : "N/A";
    const arr = payload.arrive_planned
      ? new Date(payload.arrive_planned).toLocaleString("en-GB", { timeZone: "Europe/London" })
      : "N/A";
    const delay = payload.delay_minutes ?? "TBC";

    // Fill typical fields if present (labels differ; we try multiple)
    const tryFill = async (selectorOrLabelRegex, value) => {
      try {
        if (selectorOrLabelRegex instanceof RegExp) {
          const ctl = page.getByLabel(selectorOrLabelRegex);
          if (await ctl.count()) return ctl.first().fill(String(value));
        } else {
          const ctl = page.locator(selectorOrLabelRegex);
          if (await ctl.count()) return ctl.first().fill(String(value));
        }
      } catch {}
    };

    await tryFill(/Booking\s*reference/i, ref);
    await tryFill(/Email/i, email);
    await tryFill('input[name*="booking"]', ref);
    await tryFill('input[type="email"]', email);

    // Journey notes fallback (textarea)
    const notes = page.locator("textarea, [name*='journey']");
    if (await notes.count()) {
      await notes.first().fill(
        `${origin} → ${destination}\nDepart: ${dep}\nArrive: ${arr}\nDelay approx: ${delay} mins`
      );
    }

    // Screenshot before submit
    const beforePng = await page.screenshot({ path: "avanti_before.png", fullPage: true });

    // Submit only when explicitly enabled
    if (submitLive) {
      const submitBtn = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("Submit")'
      );
      if (await submitBtn.count()) {
        await submitBtn.first().click();
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      }
    }

    const afterPng = await page.screenshot({ path: "avanti_after.png", fullPage: true });

    await browser.close();
    return {
      ok: true,
      provider: "avanti",
      submitted_at: new Date().toISOString(),
      provider_ref: null,
      screenshots: {
        before: "avanti_before.png",
        after: "avanti_after.png",
      },
      payload,
    };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "avanti", payload };
  }
}
