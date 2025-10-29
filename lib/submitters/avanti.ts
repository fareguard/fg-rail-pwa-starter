export async function submitAvanti(payload: any) {
  // TODO: replace with real form/API automation later.
  // For now we just echo the payload and pretend it's submitted.
  return {
    ok: true,
    submitted_at: new Date().toISOString(),
    provider: "avanti",
    payload
  };
}
