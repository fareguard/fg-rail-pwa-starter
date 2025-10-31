export async function submitAvanti(payload: any) {
  return {
    ok: true,
    submitted_at: new Date().toISOString(),
    provider: "avanti",
    payload
  };
}
