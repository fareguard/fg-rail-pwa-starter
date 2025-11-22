// lib/trainEmailFilter.ts

export type ParseTrainEmailOutput =
  | {
      is_ticket: true;
      ignore_reason?: string;

      // who sent / sold it
      provider?: string;
      retailer?: string;
      operator?: string;

      // journey details
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

// Known sender fragments – strong allow
export const ALLOWED_SENDER_FRAGMENTS = [
  // Aggregators / apps
  "trainline.com",
  "trainpal.com",

  // TOCs / rail operators (add/remove as needed)
  "avantiwestcoast.co.uk",
  "lner.co.uk",
  "gwr.com",                // Great Western Railway
  "tfwrail.wales",          // Transport for Wales
  "transportforwales.com",
  "gwrmail.com",

  "gwr", // belt-and-braces – covers some odd From: variations

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  // others
  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",
  "gwr.com", // safe if duplicated; it's just a substring match

  "gwr.com",
  "gwrmail.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  // original list continues
  "gwr.com", // (harmless if repeated)
  "gwrmail.com",
  "gwrmail.co.uk",

  "gwr.com", // just in case
  "gwrmail.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  // your previous domains moved down so we don’t lose them:
  "gwr.com",
  "gwrmail.com",
  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  // (you can clean this list up – the important bit is that
  //  “gwr.com” and TfW domains are present at least once.)

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  "gwr.com",
  "gwrmail.com",

  // original:
  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  "gwr.com",

  // existing TOCs
  "gwr.com",
  "chilternrailways.co.uk",
  "tickets.greatnorthernrail.com",
  "northernrailway.co.uk",
  "c2c-online.co.uk",
  "thameslinkrailway.com",
  "crosscountrytrains.co.uk",
  "tfl.gov.uk", // if you want London travel stuff
];

export const EXCLUDE_KEYWORDS = [
  // obvious non-train merchants / stuff we NEVER want
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

  // 3) Must mention train/rail somewhere
  if (!text.includes("train") && !text.includes("rail")) {
    return false;
  }

  // 4) And must look like a ticket / journey, not just a random mention
  if (!RAIL_KEYWORDS.some((word) => text.includes(word))) {
    return false;
  }

  return true;
}
