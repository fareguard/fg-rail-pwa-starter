import { chromium } from "@playwright/test";

interface AvantiClaimPayload {
  user_email: string;
  booking_ref: string | null;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  delay_minutes?: number | null;
}

export async function submitAvantiClaim(payload: AvantiClaimPayload) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1️⃣ Go to Delay Repay page
    await page.goto("https://www.avantiwestcoast.co.uk/help-and-support/delay-repay", {
      waitUntil: "domcontentloaded",
    });

    // 2️⃣ Click the “Start your claim” link or button
    const startButton = page.locator("a[href*='delay-repay']");
    if (await startButton.count()) {
      await startButton.first().click();
      await page.waitForTimeout(2000);
    }

    // 3️⃣ Fill the form (some pages open an iframe — we’ll handle that soon if needed)
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

    // Example: fill booking ref + email if found
    await page.getByLabel(/Booking reference/i).fill(ref);
    await page.getByLabel(/Email/i).fill(email);

    // These selectors will differ slightly depending on how Avanti’s form is structured.
    // We'll adjust them once we capture one real session screenshot.

    // Fill journey details (fallback: use one text area)
    const journeyInput = await page.locator("textarea, [name*='journey']");
    if (await journeyInput.count()) {
      await journeyInput.first().fill(
        `${origin} → ${destination}\nDepart: ${dep}\nArrive: ${arr}\nDelay approx: ${
          payload.delay_minutes ?? "TBC"
        } mins`
      );
    }

    // 4️⃣ Wait and take screenshot before submitting
    await page.waitForTimeout(1000);
    const screenshot = await page.screenshot({ path: "avanti_claim.png", fullPage: true });

    // 5️⃣ Click submit (safely — don’t trigger backend while testing)
    const submitBtn = page.locator("button[type=submit], input[type=submit]");
    if (await submitBtn.count()) {
      // await submitBtn.first().click(); // uncomment when ready for live
    }

    await browser.close();

    return {
      ok: true,
      submitted_at: new Date().toISOString(),
      provider: "avanti",
      payload,
    };
  } catch (err: any) {
    await browser.close();
    return { ok: false, error: err.message, provider: "avanti", payload };
  }
}
