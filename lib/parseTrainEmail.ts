// lib/parseTrainEmail.ts

type ParseTrainEmailInput = {
  id: string;
  from: string;
  subject: string;
  body: string;
};

type ParseTrainEmailOutput =
  | {
      is_ticket: true;
      provider: string;
      booking_ref: string | null;
      raw_subject: string;
      raw_from: string;
      raw_body: string;
    }
  | {
      is_ticket: false;
      ignore_reason: string;
    };

export async function parseTrainEmail(
  input: ParseTrainEmailInput,
): Promise<ParseTrainEmailOutput> {
  const { from, subject, body } = input;
  const lowerBody = body.toLowerCase();

  let provider = "unknown";

  if (from.includes("trainline.com")) provider = "trainline";
  else if (from.includes("trainpal.com")) provider = "trainpal";
  else if (from.includes("avantiwestcoast.co.uk")) provider = "avanti";
  else if (from.includes("lner.co.uk")) provider = "lner";
  else if (from.includes("gwr.com")) provider = "gwr";

  // Very dumb booking ref extraction (improve later)
  const bookingRefMatch =
    body.match(/booking reference[: ]+([A-Z0-9]{5,10})/i) ||
    body.match(/reference[: ]+([A-Z0-9]{5,10})/i);

  const booking_ref = bookingRefMatch ? bookingRefMatch[1].trim() : null;

  // If we still can't convincingly say it's a ticket, bail
  if (!booking_ref && !lowerBody.includes("e-ticket") && !lowerBody.includes("eticket")) {
    return {
      is_ticket: false,
      ignore_reason: "could not confidently parse ticket",
    };
  }

  return {
    is_ticket: true,
    provider,
    booking_ref,
    raw_subject: subject,
    raw_from: from,
    raw_body: body,
  };
}
