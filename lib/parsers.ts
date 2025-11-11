// lib/parsers.ts
// Parse UK rail ticket emails into structured trip info.
// Conservative rules: only return a trip when the message really looks like a ticket/booking.

export type Trip = {
  retailer?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
};

const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

const OPERATOR_NAMES = [
  "Avanti West Coast","Great Western Railway","West Midlands Railway","West Midlands Trains",
  "London Northwestern Railway","LNER","Northern","ScotRail","TransPennine Express",
  "Thameslink","Southern","Southeastern","Chiltern Railways","CrossCountry",
  "South Western Railway","Greater Anglia","c2c","Transport for Wales","Merseyrail"
];

const RETAILER_HINTS: Array<[RegExp,string]> = [
  [/thetrainline|trainline/i, "Trainline"],
  [/trainpal|mytrainpal|trip\.com/i, "TrainPal"],
  [/avantiwestcoast/i, "Avanti West Coast"],
  [/gwr\.com/i, "Great Western Railway"],
  [/lner/i, "LNER"],
  [/northernrailway/i, "Northern"],
  [/wmtrains|lnwrailway/i, "West Midlands Trains"],
  [/chilternrailways/i, "Chiltern Railways"],
];

const BLACKLIST_SUBJECT = [
  /newsletter|offer|sale|voucher|discount/i,
  /survey|feedback/i,
  /support ticket|customer service|verify account|account verification/i,
  /welcome\b/i,
];

const TICKETY_SUBJECT = [
  /e-?ticket|eticket/i,
  /your (?:train )?ticket/i,
  /booking (?:is )?confirmed|booking confirmation/i,
  /reservation/i
];

export function isLikelyTicketEmail(
  subject: string,
  from: string,
  body: string
): boolean {
  if (BLACKLIST_SUBJECT.some(rx => rx.test(subject))) return false;

  const positive =
    TICKETY_SUBJECT.some(rx => rx.test(subject)) ||
    /\b(e-?ticket|booking reference|PNR)\b/i.test(body);

  // Allow-list senders to reduce false positives
  const senderOk = [
    "trainline.com","thetrainline.com","trainpal.co.uk","mytrainpal.com","trainpal.com","trip.com",
    "avantiwestcoast.co.uk","gwr.com","lner.co.uk","northernrailway.co.uk","thameslinkrailway.com",
    "scotrail.co.uk","tpexpress.co.uk","wmtrains.co.uk","lnwrailway.co.uk","chilternrailways.co.uk",
    "trainsplit.com","greateranglia.co.uk","c2c-online.co.uk","southernrailway.com",
    "southeasternrailway.co.uk","crosscountrytrains.co.uk","swrailway.com","tfwrail.wales","merseyrail.org",
  ].some(dom => from.toLowerCase().includes(dom));

  return positive && senderOk;
}

// ---------- helpers ----------
function toISOFromDateTime(day: number, monthIndex1to12: number, year: number, time?: string | null) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(year, monthIndex1to12 - 1, day, hh, mm)).toISOString();
}

function pickOperator(text: string): string | null {
  for (const name of OPERATOR_NAMES) {
    if (new RegExp(name.replace(/\s+/g, "\\s+"), "i").test(text)) return name;
  }
  return null;
}

function guessRetailer(sender?: string, subject?: string, text?: string): string | null {
  const source = `${sender || ""} ${subject || ""} ${text || ""}`;
  for (const [rx, label] of RETAILER_HINTS) if (rx.test(source)) return label;
  return null;
}

// ---------- specific-ish patterns (but safe across retailers) ----------
function parseCommon(text: string, sender?: string, subject?: string): Trip {
  const t = text.replace(/\r/g, "");

  // booking ref: letters or digits 6–12 (quite common)
  const ref =
    t.match(/\b(?:Booking\s*reference|Reference)\s*[:\-]?\s*([A-Z0-9]{6,12}|\d{6,12})\b/i)?.[1] ??
    null;

  // origin / destination
  const od =
    t.match(/\b([A-Z][A-Za-z &]+)\s+to\s+([A-Z][A-Za-z &]+)\b/) ??
    t.match(/From[:\s]+([A-Z][A-Za-z &]+)\s+to[:\s]+([A-Z][A-Za-z &]+)/i);
  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  // operator + retailer guesses
  const operator = pickOperator(t);
  const retailer = guessRetailer(sender, subject, t) || operator;

  // date/time
  const date = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  const depTime =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Depart|Departs)/i)?.[1] ?? null;
  const arrTime =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Arrive|Arrival)/i)?.[1] ?? null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (date) {
    const day = parseInt(date[1], 10);
    const monthIndex = MONTHS.indexOf(date[2].toLowerCase()) + 1;
    const year = parseInt(date[3], 10);
    depart_planned = toISOFromDateTime(day, monthIndex, year, depTime);
    arrive_planned = toISOFromDateTime(day, monthIndex, year, arrTime);
  }

  return { retailer, operator, origin, destination, booking_ref: ref, depart_planned, arrive_planned };
}

// ---------- master ----------
export function parseEmail(rawText: string, sender?: string, subject?: string): Trip {
  const text = (rawText || "").replace(/\r/g, "");

  // If it doesn't look like a ticket, bail early.
  if (!isLikelyTicketEmail(subject || "", sender || "", text)) return {};

  // Single generic parser works across Trainline / TrainPal / Operators
  const trip = parseCommon(text, sender, subject);

  // Minimal sanity: require at least booking_ref OR (origin+destination)
  if (!(trip.booking_ref || (trip.origin && trip.destination))) return {};
  return trip;
}
