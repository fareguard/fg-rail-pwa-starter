// lib/ingestEmail.ts

import { isTrainEmail } from "@/lib/trainEmailFilter";
// import your existing parseTrainEmail implementation:
import { parseTrainEmail } from "@/lib/parseTrainEmail";

export type RawEmail = {
  id: string;
  from: string | null;
  subject: string | null;
  body_plain: string | null; // this MUST be in your DB
  snippet: string | null;
  // ...any other fields you have
};

export type ParsedTicketResult =
  | {
      is_ticket: true;
      ignore_reason?: undefined;
      // whatever fields your existing ticket model uses:
      provider: string;
      booking_ref: string;
      outbound_departure: string;
      // etc...
    }
  | {
      is_ticket: false;
      ignore_reason: string;
    };

export async function ingestEmail(rawEmail: RawEmail): Promise<ParsedTicketResult> {
  // Normalise / safety
  const from = (rawEmail.from || "").trim();
  const subject = (rawEmail.subject || "").trim();

  // ✅ ALWAYS prefer body_plain over snippet
  const body = (rawEmail.body_plain && rawEmail.body_plain.trim().length > 0)
    ? rawEmail.body_plain.trim()
    : (rawEmail.snippet || "").trim();

  // If somehow we have no usable body, don't bother
  if (!body) {
    return {
      is_ticket: false,
      ignore_reason: "empty body",
    };
  }

  // ✅ HARD FILTER: only train emails
  const looksLikeTrainEmail = isTrainEmail({ from, subject, body });

  if (!looksLikeTrainEmail) {
    return {
      is_ticket: false,
      ignore_reason: "non-train email",
    };
  }

  // ✅ At this point, it's *very* likely a train ticket → parse it
  const parsed = await parseTrainEmail({
    id: rawEmail.id,
    from,
    subject,
    body,
  });

  // Your parseTrainEmail should return something like:
  // { is_ticket: true, ...ticketFields } OR { is_ticket: false, ignore_reason: string }

  return parsed;
}
