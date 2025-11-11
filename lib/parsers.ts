// lib/parsers.ts
// Parse UK rail ticket emails into a Trip object.
// Start simple, extend per-operator/retailer as we go.

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
] as const;

function toISOFromDateTime(
  day: number,
  monthIndex1to12: number,
  year: number,
  hhmm?: string | null
) {
  if (!hhmm) return null;
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(year, monthIndex1to12 - 1, day, hh, mm)).toISOString();
}

function monthNameToIndex(m: string) {
  const i = MONTHS.indexOf(m.toLowerCase() as (typeof MONTHS)[number]);
  return i < 0 ? null : i + 1;
}

/* ---------------- Avanti (kept, slightly hardened) ---------------- */
function parseAvanti(text: string): Trip {
  const t = text.replace(/\r/g, "");

  const ref =
    t.match(/booking reference[:\s]+([A-Z0-9]{6,12}|\d{6,12})/i)?.[1] ?? null;

  const od =
    t.match(/\b([A-Za-z][A-Za-z\s&]+?)\s+to\s+([A-Za-z][A-Za-z\s&]+?)\b/);
  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  const operator = /Avanti West Coast/i.test(t) ? "Avanti West Coast" : null;
  const retailer = operator;

  const date = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  const dep =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Depart)/i)?.[1] ??
    null;
  const arr =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Arrive)/i)?.[1] ??
    null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (date) {
    const day = parseInt(date[1], 10);
    const month = monthNameToIndex(date[2])!;
    const year = parseInt(date[3], 10);
    depart_planned = toISOFromDateTime(day, month, year, dep);
    arrive_planned = toISOFromDateTime(day, month, year, arr);
  }

  return { retailer, operator, origin, destination, booking_ref: ref, depart_planned, arrive_planned };
}

/* ---------------- TrainPal (from your sample) ---------------- */
function parseTrainPal(text: string): Trip {
  // text is plain-text version of the email body.
  const t = text.replace(/\r/g, "");

  // Booking number: very long numeric id in these emails
  const booking_ref =
    t.match(/Booking number:\s*([A-Za-z0-9\-]+)/i)?.[1]?.trim() ?? null;

  // Example lines:
  // "Birmingham New Street to London Euston"
  const od = t.match(
    /([A-Za-z][A-Za-z\s&]+?)\s+to\s+([A-Za-z][A-Za-z\s&]+?)\b/
  );
  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  // Times:
  // "13:21" (dep), "14:56" (arr) near the OD block
  // We'll pick the first two distinct HH:MM we see.
  const times = Array.from(t.matchAll(/\b(\d{1,2}:\d{2})\b/g)).map(m => m[1]);
  const depTime = times[0] ?? null;
  const arrTime = times.find(x => x !== depTime) ?? null;

  // Date can be like: "Tue, 15 Jul 2025" OR "15/07/2025".
  let day: number | null = null, month: number | null = null, year: number | null = null;

  const d1 = t.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
  if (d1) {
    day = parseInt(d1[1], 10);
    const short = d1[2].slice(0,3).toLowerCase();
    const map: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    month = map[short];
    year = parseInt(d1[3], 10);
  } else {
    const d2 = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
    if (d2) {
      day = parseInt(d2[1], 10);
      month = parseInt(d2[2], 10);
      year = parseInt(d2[3], 10);
    }
  }

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (day && month && year) {
    depart_planned = toISOFromDateTime(day, month, year, depTime);
    arrive_planned = toISOFromDateTime(day, month, year, arrTime);
  }

  // Operator (explicit in your sample)
  // e.g. "Avanti West Coast"
  const operator =
    t.match(/\b(Avanti West Coast|Great Western Railway|London North(?:\s|-)Western|West Midlands (?:Railway|Trains)|LNER|Northern|ScotRail|TransPennine(?:\sExpress)?|Thameslink)\b/i)
      ?. [0] ?? null;

  const retailer = "TrainPal";

  return { retailer, operator, origin, destination, booking_ref, depart_planned, arrive_planned };
}

/* ---------------- Trainline / generic retailer wording ---------------- */
function parseTrainlineLike(text: string, sender?: string, subject?: string): Trip {
  const t = text.replace(/\r/g, "");

  const booking_ref =
    t.match(/Booking reference[:\s]+([A-Z0-9]{6,12}|\d{6,12})/i)?.[1] ??
    t.match(/Reference[:\s]+([A-Z0-9]{6,12}|\d{6,12})/i)?.[1] ??
    null;

  const od =
    t.match(/\b([A-Z][a-zA-Z\s&]+)\s+to\s+([A-Z][a-zA-Z\s&]+)\b/) ??
    t.match(/From[:\s]+([A-Z][a-zA-Z\s&]+)\s+to[:\s]+([A-Z][a-zA-Z\s&]+)/i);

  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  const operator =
    (/Avanti West Coast/i.test(t) && "Avanti West Coast") ||
    (/Great Western Railway|GWR/i.test(t) && "Great Western Railway") ||
    (/W(?:est )?Midlands (?:Railway|Trains)|WMR/i.test(t) && "West Midlands Trains") ||
    (/London North(?:\s|-)Western/i.test(t) && "London Northwestern Railway") ||
    (/LNER/i.test(t) && "LNER") ||
    (/Northern(?:\sRail)?/i.test(t) && "Northern") ||
    (/ScotRail/i.test(t) && "ScotRail") ||
    (/TransPennine/i.test(t) && "TransPennine Express") ||
    (/Thameslink/i.test(t) && "Thameslink") ||
    null;

  const retailer =
    (sender?.includes("trainline") && "Trainline") ||
    (sender?.includes("mytrainpal") && "TrainPal") ||
    (subject?.toLowerCase().includes("e-ticket") && "Trainline") ||
    operator ||
    null;

  const date = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  const dep =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Depart|Departs)/i)?.[1] ??
    null;
  const arr =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Arrive|Arrival)/i)?.[1] ??
    null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (date) {
    const day = parseInt(date[1], 10);
    const month = monthNameToIndex(date[2])!;
    const year = parseInt(date[3], 10);
    depart_planned = toISOFromDateTime(day, month, year, dep);
    arrive_planned = toISOFromDateTime(day, month, year, arr);
  }

  return { retailer, operator, origin, destination, booking_ref, depart_planned, arrive_planned };
}

/* ----------------– marketing filter ---------------- */
export function isLikelyMarketing(subject?: string, body?: string) {
  const s = (subject || "").toLowerCase();
  const b = (body || "").toLowerCase();

  const badSub = [
    "how was your trip",
    "welcome back",
    "exclusive perks",
    "crazy friday",
    "discount",
    "voucher",
    "survey",
    "verify account request",
    "account verification",
    "ends soon",
  ];
  if (badSub.some(k => s.includes(k))) return true;

  // require at least some trip-ish tokens if from retailers
  const hasTripTokens = /(e-?ticket|your tickets have been issued|booking number|booking reference|coach [a-z]?|seat \d+)/i.test(b);
  if (!hasTripTokens) return true;

  return false;
}

/* ---------------- Master dispatcher ---------------- */
export function parseEmail(rawText: string, sender?: string, subject?: string): Trip {
  const text = (rawText || "").replace(/\r/g, "");

  // Avanti
  if (/avantiwestcoast\.co\.uk/i.test(String(sender)) || /avanti/i.test(text)) {
    const t = parseAvanti(text);
    if (t.origin || t.destination || t.booking_ref) return t;
  }

  // TrainPal (mytrainpal.com)
  if (/mytrainpal\.com/i.test(String(sender))) {
    const t = parseTrainPal(text);
    if (t.origin || t.destination || t.booking_ref) return t;
  }

  // Generic retailer pattern (Trainline/others)
  if (
    /trainline|wmtrains|lner\.co\.uk|gwr\.com|northernrailway|thameslink|scotrail|tpexpress/i.test(String(sender)) ||
    /e-?ticket|your booking/i.test(String(subject || ""))
  ) {
    const t = parseTrainlineLike(text, sender, subject);
    if (t.origin || t.destination || t.booking_ref) return t;
  }

  // Fallback (very loose): return empty (caller will ignore)
  return {};
}
