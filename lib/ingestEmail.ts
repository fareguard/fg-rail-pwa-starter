// lib/ingestEmail.ts

export type IngestEmailInput = {
  id: string;
  from: string;
  subject: string;
  body_plain: string;
  snippet?: string;
};

export type ParseTrainEmailOutput = {
  // core flag
  is_ticket: boolean;
  ignore_reason?: string;

  // main ticket fields (all optional, we’re defensive)
  provider?: string;
  booking_ref?: string | null;

  origin?: string | null;
  destination?: string | null;

  outbound_departure?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;

  // raw debug fields
  raw_subject: string;
  raw_from: string;
  raw_body: string;
};

// Very loose list of UK rail operators / retailers we care about
const TRAIN_KEYWORDS = [
  "trainline",
  "train line",
  "lner",
  "avanti",
  "gwr",
  "great western",
  "crosscountry",
  "cross country",
  "northern",
  "thameslink",
  "southern",
  "south western",
  "c2c",
  "chiltern",
  "east midlands",
  "west midlands",
  "greater anglia",
  "transpennine",
  "scotrail",
  "tfl rail",
  "elizabeth line",
  "national rail",
  "raileasy",
  "redspottedhanky",
  "megatrain",
];

function detectProvider(from: string, subject: string, body: string): string {
  const haystack = `${from} ${subject} ${body}`.toLowerCase();

  for (const kw of TRAIN_KEYWORDS) {
    if (haystack.includes(kw)) {
      // normalise provider label a bit
      if (kw.includes("trainline")) return "Trainline";
      if (kw.includes("avanti")) return "Avanti West Coast";
      if (kw.includes("gwr") || kw.includes("great western")) return "GWR";
      if (kw.includes("cross")) return "CrossCountry";
      if (kw.includes("northern")) return "Northern";
      if (kw.includes("thameslink")) return "Thameslink";
      if (kw.includes("southern")) return "Southern";
      if (kw.includes("scotrail")) return "ScotRail";
      if (kw.includes("west midlands")) return "West Midlands Railway";
      if (kw.includes("east midlands")) return "East Midlands Railway";
      if (kw.includes("greater anglia")) return "Greater Anglia";
      if (kw.includes("chiltern")) return "Chiltern Railways";
      if (kw.includes("c2c")) return "c2c";
      if (kw.includes("transpennine")) return "TransPennine Express";
      if (kw.includes("tfl") || kw.includes("elizabeth line")) return "TfL / Elizabeth line";
      if (kw.includes("raileasy")) return "RailEasy";
      if (kw.includes("redspottedhanky")) return "redspottedhanky";
      if (kw.includes("megatrain")) return "Megatrain";

      // fallback
      return kw;
    }
  }

  // if from contains something like "Trainline <support@thetrainline.com>"
  const lowerFrom = from.toLowerCase();
  if (lowerFrom.includes("trainline")) return "Trainline";

  return "Unknown";
}

function extractBookingRef(text: string): string | null {
  const haystack = text.replace(/\s+/g, " ");

  // Common-ish patterns like ABC12345 or 8-character alphanum etc.
  const patterns: RegExp[] = [
    /booking reference[:\s]*([A-Z0-9]{6,10})/i,
    /booking ref[:\s]*([A-Z0-9]{6,10})/i,
    /reference[:\s]*([A-Z0-9]{6,10})/i,
    /\bref[:\s]*([A-Z0-9]{6,10})\b/i,
  ];

  for (const re of patterns) {
    const m = haystack.match(re);
    if (m?.[1]) return m[1].toUpperCase();
  }

  return null;
}

function extractDeparture(text: string): string | null {
  // extremely loose: time like 09:32 24/11/2025
  const re = /\b([01]\d|2[0-3]):([0-5]\d)\b/; // just get first HH:MM – we’ll improve later
  const m = text.match(re);
  if (!m) return null;
  return m[0]; // will be used as depart_planned / outbound_departure placeholder
}

/**
 * Very lightweight parser for a rail-ish email.
 * This is intentionally forgiving; the route uses it as `any` and
 * we only care that `is_ticket` is set correctly + some basic fields.
 */
export async function ingestEmail(
  input: IngestEmailInput
): Promise<ParseTrainEmailOutput> {
  const { from, subject, body_plain } = input;

  const combined = `${subject}\n${body_plain}`.toLowerCase();

  const looksLikeTicket =
    combined.includes("ticket") ||
    combined.includes("e-ticket") ||
    combined.includes("eticket") ||
    combined.includes("booking") ||
    combined.includes("journey");

  if (!looksLikeTicket) {
    return {
      is_ticket: false,
      ignore_reason: "Does not look like a ticket/booking email",
      raw_subject: subject,
      raw_from: from,
      raw_body: body_plain,
    };
  }

  const provider = detectProvider(from, subject, body_plain);
  const booking_ref = extractBookingRef(`${subject}\n${body_plain}`);
  const departTime = extractDeparture(body_plain);

  return {
    is_ticket: true,
    provider,
    booking_ref,
    origin: null,
    destination: null,
    outbound_departure: departTime,
    depart_planned: departTime,
    arrive_planned: null,
    raw_subject: subject,
    raw_from: from,
    raw_body: body_plain,
  };
}
