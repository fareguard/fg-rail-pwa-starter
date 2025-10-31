export async function submitAvanti(payload: {
  user_email?: string | null;
  booking_ref?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
  delay_minutes?: number | null;
}) {
  // TODO: swap this for a real submission via API/form automation (Playwright)
  await new Promise(r => setTimeout(r, 500));
  return {
    ok: true,
    submitted_at: new Date().toISOString(),
    provider: "avanti",
    payload,
  };
}
