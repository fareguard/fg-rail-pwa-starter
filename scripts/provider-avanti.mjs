// scripts/provider-avanti.mjs
import { chromium } from "@playwright/test";

async function dismissConsent(page) {
  // Try common TrustArc / OneTrust selectors
  const selectors = [
    '#truste-consent-button',                     // TrustArc main accept
    '.truste-button1',                            // alt TrustArc class
    'a.truste_button_1',                          // older TrustArc
    '#onetrust-accept-btn-handler',               // OneTrust
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
  ];

  for (const sel of selectors) {
    const el = page.locator(sel);
    try {
      if (await el.count()) {
        await el.first().click({ timeout: 1000 }).catch(() => {});
      }
    } catch {}
  }

  // Brutal fallback: remove overlays that intercept pointer events
  await page.evaluate(() => {
    const killers = [
      '.truste_overlay', '.truste_box_overlay_border', '.truste_cm_outerdiv',
      '#truste-consent-track', '#truste-consent-required',
      '#onetrust-banner-sdk', '.ot-sdk-container', '.ot-sdk-row'
    ];
    killers.forEach(k => document.querySelectorAll(k).forEach(n => n.remove()));
  }).catch(() => {});
}

async function safeClick(page, locator) {
  try {
    await locator.first().click({ timeout: 2000 });
    return true;
  } catch {
    // Try dismissing overlays then click again
    await dismissConsent(page);
    try {
      await locator.first().click({ timeout: 2500 });
      return true;
    } catch {
      // Force click as last resort
      try {
        await locator.first().click({ timeout: 2500, force: true });
        return true;
      } catch {
        return false;
      }
    }
  }
}

export async function submitAvantiClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // Go straight to Delay Repay portal (avoids marketing page redirect/overlays)
    await page.goto('https://delayrepay.avantiwestcoast.co.uk/en/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await dismissConsent(page);

    // If we didn't land on login, try a visible CTA as fallback
    if (!/delayrepay\..*\/en\/login/i.test(page.url())) {
      const start = page.locator('a:has-text("Delay Repay"), a:has-text("Start"), a[href*="delay-repay"]');
      if (await start.count()) {
        await safeClick(page, start);
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      }
      await dismissConsent(page);
    }

    // Prepare values
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

    // Take a snapshot on arrival
    await page.screenshot({ path: "avanti_before.png", fullPage: true }).catch(() => {});

    // Fill what we can on login/start page (selectors vary; we try broadly)
    const tryFill = async (selectorOrLabelRegex, value) => {
      try {
        if (value == null) return;
        if (selectorOrLabelRegex instanceof RegExp) {
          const ctl = page.getByLabel(selectorOrLabelRegex);
          if (await ctl.count()) return ctl.first().fill(String(value));
        } else {
          const ctl = page.locator(selectorOrLabelRegex);
          if (await ctl.count()) return ctl.first().fill(String(value));
        }
      } catch {}
    };

    await tryFill(/Email/i, email);
    await tryFill('input[type="email"]', email);
    await tryFill(/Booking\s*reference/i, ref);
    await tryFill('input[name*="booking"]', ref);

    // Journey notes (if a textarea exists)
    const notes = page.locator("textarea, [name*='journey']");
    if (await notes.count()) {
      await notes.first().fill(
        `${origin} → ${destination}\nDepart: ${dep}\nArrive: ${arr}\nDelay approx: ${delay} mins`
      ).catch(() => {});
    }

    // Submit only if explicitly enabled
    if (submitLive) {
      // Typical submit
      const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Continue")');
      if (await submitBtn.count()) {
        await safeClick(page, submitBtn);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      }
    }

    await page.screenshot({ path: "avanti_after.png", fullPage: true }).catch(() => {});
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
