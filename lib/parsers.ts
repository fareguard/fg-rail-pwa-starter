// lib/parsers.ts
// Parses rail ticket emails into structured trip info.
// Keep this file simple + robust. We'll extend operators over time.

type Trip = {
  retailer?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
};

// ---- Helpers ----
function toISOFromDateTime(day: number, monthIndex1to12: number, year: number, time?: string | null) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  // Use UTC to avoid TZ ambiguity in storage
  return new Date(Date.UTC(year, monthIndex1to12 - 1, day, hh, mm)).toISOString();
}

const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

// ---- Avanti West Coast (kept from your version + small hardening) ----
function parseAvantiEmail(text: string): Trip {
  const t = text.replace(/\r/g, "");

  // booking ref (letters or digits 6–12)
  const refMatch = t.match(/Booking reference:\s*([A-Z0-9]{6,12}|\d{6,12})/i);
  const booking_ref = refMatch?.[1]?.trim() ?? null;

  // origin/destination
  const od1 = t.match(/\b([A-Za-z][A-Za-z\s&]+?)\s+to\s+([A-Za-z][A-Za-z\s&]+?)\b/);
  const origin = od1?.[1]?.trim() ?? null;
  const destination = od1?.[2]?.trim() ?? null;

  // operator
  const operator = /Avanti West Coast/i.test(t) ? "Avanti West Coast" : null;
  const retailer = operator;

  // date/time
  const dateMatch = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  const depTime =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Depart)/i)?.[1] ?? null;
  const arrTime =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Arrive)/i)?.[1] ?? null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthIndex = MONTHS.indexOf(dateMatch[2].toLowerCase()) + 1;
    const year = parseInt(dateMatch[3], 10);
    depart_planned = toISOFromDateTime(year, monthIndex, day, depTime);
    arrive_planned = toISOFromDateTime(year, monthIndex, day, arrTime);
  }

  return { retailer, operator, origin, destination, booking_ref, depart_planned, arrive_planned };
}

// ---- Trainline / Generic UK retailers (common wording) ----
function parseTrainlineLike(text: string, sender?: string, subject?: string): Trip {
  const t = text.replace(/\r/g, "");

  // Booking reference patterns often shown as "Booking reference ABC1234" or "Reference: ABC1234"
  const ref =
    t.match(/Booking reference[:\s]+([A-Z0-9]{6,12}|\d{6,12})/i)?.[1] ??
    t.match(/Reference[:\s]+([A-Z0-9]{6,12}|\d{6,12})/i)?.[1] ??
    null;

  // Origin / destination
  const od =
    t.match(/\b([A-Z][a-zA-Z\s&]+)\s+to\s+([A-Z][a-zA-Z\s&]+)\b/) ??
    t.match(/From[:\s]+([A-Z][a-zA-Z\s&]+)\s+to[:\s]+([A-Z][a-zA-Z\s&]+)/i);
  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;

  // Operator detection (a few common ones)
  const operator =
    (/Avanti West Coast/i.test(t) && "Avanti West Coast") ||
    (/Great Western Railway|GWR/i.test(t) && "Great Western Railway") ||
    (/West Midlands Trains|West Midlands Railway|WMR/i.test(t) && "West Midlands Trains") ||
    (/London North Eastern Railway|LNER/i.test(t) && "LNER") ||
    (/Northern(?:\sRail)?/i.test(t) && "Northern") ||
    (/ScotRail/i.test(t) && "ScotRail") ||
    (/TransPennine/i.test(t) && "TransPennine Express") ||
    (/Thameslink/i.test(t) && "Thameslink") ||
    null;

  // Retailer guess from sender/subject
  const retailer =
    (sender?.includes("trainline.com") && "Trainline") ||
    (sender?.includes("trainpal") && "TrainPal") ||
    (subject?.includes("e-ticket") && "Trainline") ||
    operator ||
    null;

  // Date + time
  const date = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
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
    depart_planned = toISOFromDateTime(year, monthIndex, day, depTime);
    arrive_planned = toISOFromDateTime(year, monthIndex, day, arrTime);
  }

  return { retailer, operator, origin, destination, booking_ref: ref, depart_planned, arrive_planned };
}

// ---- Fallback generic (kept light) ----
function parseGeneric(text: string): Trip {
  const t = text.replace(/\r/g, "");
  const od = t.match(/\b([A-Z][a-zA-Z\s&]+)\s+to\s+([A-Z][a-zA-Z\s&]+)\b/);
  const ref = t.match(/\b([A-Z0-9]{6,12})\b/); // loose
  return {
    origin: od?.[1]?.trim() ?? null,
    destination: od?.[2]?.trim() ?? null,
    booking_ref: ref?.[1] ?? null,
  };
}

// ---- Master parser ----
export function parseEmail(rawText: string, sender?: string, subject?: string): Trip {
  const text = (rawText || "").replace(/\r/g, "");

  // 1) Avanti detector
  if (
    /avanti/i.test(text) ||
    /@avantiwestcoast\.co\.uk/i.test(sender || "") ||
    /Avanti West Coast/i.test(subject || "")
  ) {
    const a = parseAvantiEmail(text);
    if (a.origin || a.destination || a.booking_ref) return a;
  }

  // 2) Trainline / TrainPal and other UK retailers
  if (
    /trainline|trainpal|thetrainline/i.test(sender || "") ||
    /e-ticket|eticket|your ticket|your booking/i.test(subject || "")
  ) {
    const tl = parseTrainlineLike(text, sender, subject);
    if (tl.origin || tl.destination || tl.booking_ref) return tl;
  }

  // 3) Generic fallback
  return parseGeneric(text);
}
