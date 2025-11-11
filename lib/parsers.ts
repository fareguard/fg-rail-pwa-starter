// lib/parsers.ts
// Robust UK rail e-ticket parser with a confidence score.
// We add operators/retailers over time. Keep this file simple.

export type Trip = {
  retailer?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
  confidence?: number; // 0..1
};

const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

const STATION_WORD = /[A-Z][a-zA-Z'&.\- ]{2,}/;

// very common UK retailers/operators (extend over time)
const OPERATOR_HINTS: Array<[RegExp, string]> = [
  [/Avanti West Coast/i, "Avanti West Coast"],
  [/(Great Western Railway|GWR)/i, "Great Western Railway"],
  [/(West Midlands (Railway|Trains)|WMR)/i, "West Midlands Trains"],
  [/(London North Eastern Railway|LNER)/i, "LNER"],
  [/ScotRail/i, "ScotRail"],
  [/TransPennine/i, "TransPennine Express"],
  [/Thameslink/i, "Thameslink"],
  [/Southern Railway/i, "Southern"],
  [/Southeastern/i, "Southeastern"],
  [/Northern(?:\sRail)?/i, "Northern"],
];

const RETAILER_HINTS: Array<[RegExp, string]> = [
  [/trainline\.com/i, "Trainline"],
  [/trainpal/i, "TrainPal"],
];

function monthIndex(name: string) {
  const i = MONTHS.indexOf(name.toLowerCase());
  return i < 0 ? null : i + 1;
}

function toISO(y: number, m1: number|null, d: number, time?: string|null) {
  if (!m1 || !time) return null;
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m1 - 1, d, hh, mm)).toISOString();
}

function detectOperator(text: string): string | null {
  for (const [re, name] of OPERATOR_HINTS) if (re.test(text)) return name;
  return null;
}

function detectRetailer(text: string, sender?: string, subject?: string): string | null {
  for (const [re, name] of RETAILER_HINTS)
    if (re.test(sender || "") || re.test(text) || re.test(subject || "")) return name;
  return null;
}

// Generic UK rail parse (works for Trainline, operators, etc.)
function parseGenericUK(text: string, sender?: string, subject?: string): Trip {
  const t = text.replace(/\r/g, "");

  // booking ref — many UK retailers use 6–12 alnum or digits
  const booking_ref =
    t.match(/\b(Booking\s*reference|Reference)\s*[:\- ]+([A-Z0-9]{6,12})\b/i)?.[2] ??
    t.match(/\b([A-Z0-9]{6,12})\b(?=[^\n]{0,40}(reference|booking))/i)?.[1] ??
    null;

  // origin / destination — simple “X to Y” heuristic
  const od =
    t.match(new RegExp(String.raw`\b(${STATION_WORD.source})\s+to\s+(${STATION_WORD.source})\b`));
  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  // datetime
  const date =
    t.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  const depTime =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Departs|Depart)/i)?.[1] ??
    null;
  const arrTime =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Arrive|Arrival)/i)?.[1] ??
    null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (date) {
    const day = parseInt(date[1], 10);
    const m = monthIndex(date[2]);
    const year = parseInt(date[3], 10);
    depart_planned = toISO(year, m, day, depTime);
    arrive_planned = toISO(year, m, day, arrTime);
  }

  // operator & retailer hints
  const operator = detectOperator(t);
  const retailer = detectRetailer(t, sender, subject) || operator;

  // confidence: require multiple independent signals to be “ticket”
  let score = 0;
  if (booking_ref) score += 0.35;
  if (origin && destination) score += 0.35;
  if (depart_planned) score += 0.20;
  if (operator || retailer) score += 0.10;
  score = Math.min(1, score);

  return { retailer, operator, origin, destination, booking_ref, depart_planned, arrive_planned, confidence: score };
}

// public API
export function parseEmail(rawText: string, sender?: string, subject?: string): Trip {
  const text = (rawText || "").replace(/\r/g, "");
  return parseGenericUK(text, sender, subject);
}
