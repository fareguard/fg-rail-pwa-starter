// scripts/provider-avanti.mjs
import { chromium } from "@playwright/test";

const COOKIE_SELECTORS = [
  // OneTrust / TrustArc variants seen on Avanti
  '#onetrust-accept-btn-handler',
  'button[aria-label*="Accept"]',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  '#truste-consent-button',
  '.truste_popframe .call, .truste_box_overlay_border ~ button:has-text("I Agree")',
];

async function clearCookieWall(page) {
  // Try normal clicks first
  for (const sel of COOKIE_SELECTORS) {
    const btn = page.locator(sel);
    if (await btn.first().isVisible().catch(() => false)) {
      try { await btn.first().click({ timeout: 2000 }); return; } catch {}
    }
  }
  // If overlay still intercepts, nuke it (safe for headless CI)
  await page.evaluate(() => {
    const killers = [
      '[id^="onetrust"]',
      '.ot-sdk-container',
      '.ot-sdk-row',
      '.truste_box_overlay_border',
      '.truste_overlay',
      '#truste-consent-track',
      '.truste_cm_outerdiv',
    ];
    document.querySelectorAll(killers.join(",")).forEach(el => {
      try { el.style.display = "none"; el.remove?.(); } catch {}
    });
  }).catch(() => {});
}

export async function submitAvantiClaim(payload, { submitLive = false } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  try {
    await page.goto("https://www.avantiwestcoast.co.uk/help-and-support/delay-repay", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await clearCookieWall(page);

    // Be explicit about the target domain before interacting
    await page.waitForURL(/avantiwestcoast\.co\.uk\/help-and-support\/delay-repay/i, { timeout: 10000 })
      .catch(() => {});

    // Find “Delay Repay / Start” CTA, with fallbacks
    const start = page.locator(
      [
        'a:has-text("Delay Repay")',
        'a:has-text("Start")',
        'a[href*="delay-repay"]',
        'a[title*="Delay Repay"]',
      ].join(", ")
    );

    if (await start.count()) {
      try {
        await start.first().click({ timeout: 30000 });
      } catch {
        // If overlay intercepts again, purge & retry once
        await clearCookieWall(page);
        await start.first().click({ timeout: 30000 });
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    }

    // Hard wait for the Delay Repay subdomain (login/start/claim)
    await page.waitForURL(
      /delayrepay\..*\/(en|gb)\/(login|start|claim)/i,
      { timeout: 15000 }
    ).catch(() => {});

    // --------- Populate basics (best-effort) ----------
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

    const notes = page.locator("textarea, [name*='journey']");
    if (await notes.count()) {
      await notes.first().fill(
        `${origin} → ${destination}\nDepart: ${dep}\nArrive: ${arr}\nDelay approx: ${delay} mins`
      );
    }

    // Screens before/after
    const beforePng = await page.screenshot({ path: "avanti_before.png", fullPage: true });

    if (submitLive) {
      const submitBtn = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Continue")'
      );
      if (await submitBtn.count()) {
        await submitBtn.first().click().catch(() => {});
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
      screenshots: { before: "avanti_before.png", after: "avanti_after.png" },
      payload,
    };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err?.message || String(err), provider: "avanti", payload };
  }
}
