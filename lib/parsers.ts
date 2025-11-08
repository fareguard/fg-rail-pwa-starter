// lib/parsers.ts
// Parse UK rail ticket emails into a normalized "Trip" object.
// Simple, robust, operator-agnostic; we can extend patterns over time.

export type Trip = {
  retailer?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
};

// ── helpers ───────────────────────────────────────────────────────────────────
const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

function toISO(y: number, m1to12: number, d: number, time?: string | null) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m1to12 - 1, d, hh, mm)).toISOString();
}

function norm(text: string) {
  return (text || "").replace(/\r/g, "");
}

// ── operator + retailer heuristics ────────────────────────────────────────────
function detectOperator(t: string): string | null {
  if (/Avanti West Coast/i.test(t)) return "Avanti West Coast";
  if (/(Great Western Railway|GWR)/i.test(t)) return "Great Western Railway";
  if (/(West Midlands Trains|West Midlands Railway|WMR)/i.test(t)) return "West Midlands Trains";
  if (/(London North Eastern Railway|LNER)/i.test(t)) return "LNER";
  if (/Thameslink/i.test(t)) return "Thameslink";
  if (/(Northern(?:\sRail)?)/i.test(t)) return "Northern";
  if (/ScotRail/i.test(t)) return "ScotRail";
  if (/TransPennine/i.test(t)) return "TransPennine Express";
  if (/Southern/i.test(t)) return "Southern";
  if (/Southeastern/i.test(t)) return "Southeastern";
  if (/c2c/i.test(t)) return "c2c";
  return null;
}

function detectRetailer(t: string, sender?: string, subject?: string): string | null {
  if (sender?.includes("trainline.com")) return "Trainline";
  if (/thetrainline/i.test(t) || /e-ticket/i.test(subject || "")) return "Trainline";
  if (/trainpal/i.test(sender || "") || /trainpal/i.test(t)) return "TrainPal";
  return detectOperator(t);
}

// ── pattern families ──────────────────────────────────────────────────────────

// “Trainline-like” (and many operator emails)
function parseTrainlineFamily(text: string, sender?: string, subject?: string): Trip {
  const t = norm(text);

  // booking ref: “Booking reference ABC1234”, “Reference: ABC1234”
  const booking_ref =
    t.match(/Booking reference[:\s]+([A-Z0-9]{6,12}|\d{6,12})/i)?.[1] ??
    t.match(/\bReference[:\s]+([A-Z0-9]{6,12}|\d{6,12})\b/i)?.[1] ??
    null;

  // origin/destination: “From X to Y” or “X to Y”
  const od =
    t.match(/From[:\s]+([A-Z][A-Za-z\s&]+)\s+to[:\s]+([A-Z][A-Za-z\s&]+)\b/i) ??
    t.match(/\b([A-Z][A-Za-z\s&]+)\s+to\s+([A-Z][A-Za-z\s&]+)\b/);
  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  // operator + retailer
  const operator = detectOperator(t);
  const retailer = detectRetailer(t, sender, subject);

  // date + times (e.g., “27 October 2025” + “Depart 08:15”, “Arrive 10:38”)
  const date =
    t.match(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
    ) ?? undefined;

  const depTime =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Depart|Departs)/i)?.[1] ??
    null;

  const arrTime =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/(\d{1,2}:\d{2})\s*(?:Arrive|Arrival)/i)?.[1] ??
    null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;

  if (date) {
    const day = parseInt(date[1], 10);
    const monthIndex = MONTHS.indexOf(date[2].toLowerCase()) + 1;
    const year = parseInt(date[3], 10);
    depart_planned = toISO(year, monthIndex, day, depTime);
    arrive_planned = toISO(year, monthIndex, day, arrTime);
  }

  return { retailer, operator, origin, destination, booking_ref, depart_planned, arrive_planned };
}

// Minimal generic fallback
function parseGeneric(text: string): Trip {
  const t = norm(text);
  const od = t.match(/\b([A-Z][A-Za-z\s&]+)\s+to\s+([A-Z][A-Za-z\s&]+)\b/);
  const ref = t.match(/\b([A-Z0-9]{6,12})\b/);
  return {
    origin: od?.[1]?.trim() ?? null,
    destination: od?.[2]?.trim() ?? null,
    booking_ref: ref?.[1] ?? null,
  };
}

// ── public API ────────────────────────────────────────────────────────────────
export function parseEmail(rawText: string, sender?: string, subject?: string): Trip {
  const text = norm(rawText || "");

  // Trainline / operator-style emails → broad matcher
  const tl = parseTrainlineFamily(text, sender, subject);
  if (tl.origin || tl.destination || tl.booking_ref) return tl;

  // Fallback
  return parseGeneric(text);
}
