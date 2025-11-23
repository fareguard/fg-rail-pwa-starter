// lib/trainEmailFilter.ts

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

      // we allow null here – UI will show "Departs: —"
      depart_planned: string | null;
      arrive_planned: string | null;
      outbound_departure: string | null;
    }
  | {
      is_ticket: false;
      ignore_reason: string;
    };

// ---------------------------------------------------------------------------
// Strong allowlist of senders. If the "from" address contains any of these
// fragments, we treat it as a rail email without needing "train"/"rail" words.
// ---------------------------------------------------------------------------
export const ALLOWED_SENDER_FRAGMENTS = [
  // Aggregators / apps
  "trainline.com",
  "info.thetrainline.com",
  "trainpal.com",

  // Common shared booking platform for several TOCs
  "trainsfares.co.uk", // ScotRail, Greater Anglia, Northern, etc

  // Individual TOCs / operators
  "avantiwestcoast.co.uk",
  "lner.co.uk",
  "gwr.com",
  "gwrmail.com",
  "tfwrail.wales",
  "transportforwales.com",
  "chilternrailways.co.uk",
  "northernrailway.co.uk",
  "southwesternrailway.com",
  "scotrail",
  "greateranglia",
  "c2c-online.co.uk",
  "thameslinkrailway.com",
  "crosscountrytrains.co.uk",
  "tfl.gov.uk", // if you want London travel stuff
];

// Obvious non-train merchants / stuff we NEVER want
export const EXCLUDE_KEYWORDS = [
  "costa",
  "starbucks",
  "uber",
  "ubereats",
  "just eat",
  "deliveroo",
  "hotel",
  "airbnb",
  "booking.com",
  "payment receipt",
  "invoice",
  "subscription",
];

// Phrases that usually indicate a rail ticket / journey
export const RAIL_KEYWORDS = [
  "e-ticket",
  "eticket",
  "your ticket",
  "ticket for",
  "your journey",
  "outward journey",
  "return journey",
  "departure",
  "arrival",
  "platform",
  "coach",
  "carriage",
  "seat",
  "railcard",
  "train to",
  "train from",
  "booking confirmation",
  "your booking reference",
];

type TrainEmailCheckInput = {
  from?: string | null;
  subject?: string | null;
  body?: string | null;
};

export function isTrainEmail(input: TrainEmailCheckInput): boolean {
  const from = (input.from || "").toLowerCase();
  const subject = (input.subject || "").toLowerCase();
  const body = (input.body || "").toLowerCase();

  const text = `${subject} ${body}`;

  // 1) Strong allow by known sender domains
  if (ALLOWED_SENDER_FRAGMENTS.some((frag) => from.includes(frag))) {
    return true;
  }

  // 2) Quick hard reject for obvious non-train stuff
  if (EXCLUDE_KEYWORDS.some((word) => text.includes(word))) {
    return false;
  }

  // 3) Must mention train/rail somewhere for unknown senders
  if (!text.includes("train") && !text.includes("rail")) {
    return false;
  }

  // 4) And must look like a ticket / journey, not just a random mention
  if (!RAIL_KEYWORDS.some((word) => text.includes(word))) {
    return false;
  }

  return true;
}
