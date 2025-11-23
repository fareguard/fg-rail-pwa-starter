// lib/trainEmailFilter.ts
// CLEAN, GENERAL, UK-WIDE VERSION (no duplication, no hacks)

export type ParseTrainEmailOutput =
  | {
      is_ticket: true;
      ignore_reason?: string;
      provider?: string;
      retailer?: string;
      operator?: string;
      booking_ref?: string;
      origin?: string;
      destination?: string;
      depart_planned?: string;
      arrive_planned?: string;
      outbound_departure?: string;
    }
  | {
      is_ticket: false;
      ignore_reason: string;
      provider?: string;
      retailer?: string;
      operator?: string;
      booking_ref?: string;
      origin?: string;
      destination?: string;
      depart_planned?: string;
      arrive_planned?: string;
      outbound_departure?: string;
    };

export type ParsedTicketResult =
  | {
      is_ticket: true;
      ignore_reason?: undefined;
      provider: string;
      retailer: string | null;
      operator: string | null;
      booking_ref: string;
      origin: string;
      destination: string;
      depart_planned: string | null;
      arrive_planned: string | null;
      outbound_departure: string | null;
    }
  | {
      is_ticket: false;
      ignore_reason: string;
    };

// ---------------------------------------------------------------------------
// 1) Known legitimate sender domains
// ---------------------------------------------------------------------------

export const ALLOWED_SENDER_FRAGMENTS = [
  // Aggregators
  "trainline.",
  "trainpal.",
  "raileasy.",

  // UK Train Operators (TOCs)
  "avantiwestcoast.",
  "lner.",
  "gwr.",
  "southeasternrailway.",
  "southernrailway.",
  "swrailway.",              // South Western Railway
  "southwesternrailway.",
  "northernrailway.",
  "scotrail.co.uk",
  "tpexpress.co.uk",
  "chilternrailways.",
  "crosscountrytrains.",
  "merseyrail.org",
  "c2c-online.",
  "thameslinkrailway.",
  "transportforwales",
  "tfwrail.",
  "gatwickexpress.",
  "heathrowexpress.",
];

// ---------------------------------------------------------------------------
// 2) Auto-REJECT words (marketing, payments, etc.)
// ---------------------------------------------------------------------------

export const EXCLUDE_KEYWORDS = [
  "receipt",
  "payment",
  "invoice",
  "booking.com",
  "costa",
  "starbucks",
  "ubereats",
  "just eat",
  "deliveroo",
  "hotel",
  "airbnb",
  "subscription",
];

// ---------------------------------------------------------------------------
// 3) Ticket indicator keywords (broad)
// ---------------------------------------------------------------------------

export const RAIL_KEYWORDS = [
  "e-ticket",
  "eticket",
  "your ticket",
  "booking reference",
  "booking confirmation",
  "your journey",
  "outward journey",
  "return journey",
  "seat",
  "coach",
  "platform",
  "railcard",
  "depart",
  "arrive",
  "to ",
  "→",                    // operator emails often use this
];

// ---------------------------------------------------------------------------
// 4) MAIN FILTER
// ---------------------------------------------------------------------------

export function isTrainEmail(input: {
  from?: string | null;
  subject?: string | null;
  body?: string | null;
}): boolean {
  const from = (input.from || "").toLowerCase();
  const subject = (input.subject || "").toLowerCase();
  const body = (input.body || "").toLowerCase();

  const text = `${subject} ${body}`;

  // (A) If sender is a known TOC/retailer → ALWAYS allow
  if (ALLOWED_SENDER_FRAGMENTS.some((frag) => from.includes(frag))) {
    return true;
  }

  // (B) Hard reject obvious non-ticket emails
  if (EXCLUDE_KEYWORDS.some((word) => text.includes(word))) {
    return false;
  }

  // (C) Soft allow if typical ticket wording appears
  if (RAIL_KEYWORDS.some((word) => text.includes(word))) {
    return true;
  }

  // (D) Otherwise reject
  return false;
}
