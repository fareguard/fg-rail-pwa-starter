import { submitAvanti } from "./avanti";

export function guessProvider(operator?: string | null): string {
  const op = (operator || "").toLowerCase();
  if (op.includes("avanti")) return "avanti";
  if (op.includes("northern")) return "northern";
  if (op.includes("gwr")) return "gwr";
  if (op.includes("lner")) return "lner";
  return "generic";
}

export async function submitClaimToProvider(provider: string, data: any) {
  switch (provider) {
    case "avanti":
      return submitAvanti(data);
    default:
      return { ok:true, submitted_at:new Date().toISOString(), provider, payload:data };
  }
}
