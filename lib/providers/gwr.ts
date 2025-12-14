// lib/providers/gwr.ts
import { chromium } from "@playwright/test";

type SubmitInput = {
  user_email: string | null;
  booking_ref: string | null;
  operator: string | null;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  delay_minutes: number | null;
};

export async function submitGwrClaim(payload: SubmitInput) {
  // 🚨 HARD GATE — never submit without delay
  if (payload.delay_minutes == null) {
    return {
      ok: false,
      error: "Missing delay_minutes (delay check not completed)",
      raw: { payload },
    };
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto("https://delayrepay.gwr.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Cookies
    const cookieBtn = page.locator('button:has-text("Accept")');
    if (await cookieBtn.count()) await cookieBtn.click();

    // Guest flow
    const guestBtn = page.locator('button:has-text("Continue as Guest")');
    if (await guestBtn.count()) {
      await guestBtn.click();
      await page.waitForLoadState("domcontentloaded");
    }

    // Fill basics
    await page.fill('input[type="email"]', payload.user_email || "hello@fareguard.co.uk");
    await page.fill(
      'input[name*="booking"], input[name*="reference"]',
      payload.booking_ref || ""
    );

    // 🚧 Delay band selection (example – selector may change)
    // You will refine this once delay bands are known
    const delay = payload.delay_minutes;
    if (delay >= 15 && delay < 30) {
      await page.click('text=15 to 29 minutes');
    } else if (delay >= 30 && delay < 60) {
      await page.click('text=30 to 59 minutes');
    } else if (delay >= 60) {
      await page.click('text=60 minutes or more');
    } else {
      throw new Error("Delay below compensation threshold");
    }

    // Submit
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle");

    // Reference extraction (placeholder)
    const provider_ref = `GWR-${Date.now()}`;

    await browser.close();
    return {
      ok: true,
      submitted_at: new Date().toISOString(),
      provider_ref,
      raw: { payload },
    };
  } catch (e: any) {
    await browser.close();
    return {
      ok: false,
      error: e?.message || String(e),
      raw: { payload },
    };
  }
}