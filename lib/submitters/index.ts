import { submitAvanti } from "./avanti";

export function guessProvider(operator?: string | null): string {
  const op = (operator || "").toLowerCase();
  if (op.includes("avanti")) return "avanti";
  if (op.includes("northern")) return "northern";
  if (op.includes("gwr")) return "gwr";
  if (op.includes("lner")) return "lner";
  return "generic";
}

export async function submitClaimToProvider(provider: string, data: {
  user_email: string | null,
  booking_ref?: string | null,
  operator?: string | null,
  origin?: string | null,
  destination?: string | null,
  depart_planned?: string | null,
  arrive_planned?: string | null,
  delay_minutes?: number | null
}) {
  switch (provider) {
    case "avanti":
      return submitAvanti(data);
    default:
      // generic stub
      return {
        ok: true,
        submitted_at: new Date().toISOString(),
        provider,
        payload: data
      };
  }
}
