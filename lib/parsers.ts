// lib/parsers.ts
// Parses rail ticket emails into structured trip info.
// Keep this file simple + robust. We'll extend operators over time.

export type Trip = {
  retailer?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
  is_ticket?: boolean; // <-- key flag: only "true" means we treat as a real ticket
};

// ---- Helpers ----
function toISOFromDateTime(
  day: number,
  monthIndex1to12: number,
  year: number,
  time?: string | null
) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  // Use UTC to avoid TZ ambiguity in storage
  return new Date(Date.UTC(year, monthIndex1to12 - 1, day, hh, mm)).toISOString();
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Normalise “station-ish” text – strip Avanti boilerplate etc.
function cleanStationName(name: string | null): string | null {
  if (!name) return null;
  let s = name;

  s = s.replace(
    /Your booking is confirmed\s+Thank you for booking with Avanti West Coast/gi,
    ""
  );
  s = s.replace(/Thank you for booking with Avanti West Coast/gi, "");
  s = s.replace(/Your booking is confirmed/gi, "");
  s = s.replace(/\s+/g, " ").trim();

  return s || null;
}

// Small helper so we only call something a "ticket" if it looks like a real journey
function computeIsTicket(trip: Trip): boolean {
  return !!(trip.origin && trip.destination && trip.depart_planned);
}

// ---- Avanti West Coast ----
function parseAvantiEmail(text: string): Trip {
  const t = text.replace(/\r/g, "");

  // booking ref (letters or digits 6–12)
  const refMatch = t.match(/Booking reference:\s*([A-Z0-9]{6,12}|\d{6,12})/i);
  const booking_ref = refMatch?.[1]?.trim() ?? null;

  // origin/destination:
  //  - find ALL "... X to Y ..." patterns
  //  - take the *last* one (closest to the actual ticket summary)
  const odMatches = Array.from(
    t.matchAll(
      /\b([A-Z][A-Za-z\s&]+?)\s+to\s+([A-Z][A-Za-z\s&]+?)\s*(?:£|\n|$)/g
    )
  );

  let origin: string | null = null;
  let destination: string | null = null;
  if (odMatches.length) {
    const last = odMatches[odMatches.length - 1];
    origin = cleanStationName(last[1]?.trim() ?? null);
    destination = cleanStationName(last[2]?.trim() ?? null);
  }

  // operator
  const operator = /Avanti West Coast/i.test(t) ? "Avanti West Coast" : null;
  const retailer = operator;

  // date/time
  const dateMatch = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  const depTime =
    t.match(/Depart(?:ure)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]{0,40}Depart)/i)?.[1] ??
    null;
  const arrTime =
    t.match(/Arriv(?:al|e)\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]{0,40}Arrive)/i)?.[1] ??
    null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthIndex = MONTHS.indexOf(dateMatch[2].toLowerCase()) + 1;
    const year = parseInt(dateMatch[3], 10);
    depart_planned = toISOFromDateTime(year, monthIndex, day, depTime);
    arrive_planned = toISOFromDateTime(year, monthIndex, day, arrTime);
  }

  const trip: Trip = {
    retailer,
    operator,
    origin,
    destination,
    booking_ref,
    depart_planned,
    arrive_planned,
  };
  trip.is_ticket = computeIsTicket(trip);
  return trip;
}

// ---- Trainline / TrainPal / generic UK retailers ----
function parseTrainlineLike(text: string, sender?: string, subject?: string): Trip {
  const t = text.replace(/\r/g, "");

  // Booking reference patterns often shown as "Booking number" or "Booking reference"
  const ref =
    t.match(/Booking (?:number|reference)[:\s]+([A-Z0-9]{6,20}|\d{6,20})/i)?.[1] ??
    t.match(/Reference[:\s]+([A-Z0-9]{6,20}|\d{6,20})/i)?.[1] ??
    null;

  // Origin / destination:
  //  - X to Y
  //  - X -> Y
  //  - X - Y / X – Y
  const od =
    t.match(
      /\b([A-Z][a-zA-Z\s&]+?)\s+(?:to|->|-|–|—|→)\s+([A-Z][a-zA-Z\s&]+?)\b/
    ) ??
    t.match(
      /From[:\s]+([A-Z][a-zA-Z\s&]+)\s+to[:\s]+([A-Z][a-zA-Z\s&]+)/i
    );

  const origin = cleanStationName(od?.[1]?.trim() ?? null);
  const destination = cleanStationName(od?.[2]?.trim() ?? null);

  // Operator detection (a few common ones)
  const operator =
    (/Avanti West Coast/i.test(t) && "Avanti West Coast") ||
    (/Great Western Railway|GWR/i.test(t) && "Great Western Railway") ||
    (/West Midlands Trains|West Midlands Railway|WMR/i.test(t) &&
      "West Midlands Trains") ||
    (/London North Western Railway|LNWR/i.test(t) &&
      "London Northwestern Railway") ||
    (/Northern(?:\sRail)?/i.test(t) && "Northern") ||
    (/ScotRail/i.test(t) && "ScotRail") ||
    (/TransPennine/i.test(t) && "TransPennine Express") ||
    (/Thameslink/i.test(t) && "Thameslink") ||
    (/Chiltern Railways/i.test(t) && "Chiltern Railways") ||
    null;

  // Retailer guess from sender/subject
  const retailer =
    (sender?.includes("trainline.com") && "Trainline") ||
    (sender?.includes("mytrainpal.com") && "TrainPal") ||
    (subject && /Trainline/i.test(subject) && "Trainline") ||
    (subject && /TrainPal/i.test(subject) && "TrainPal") ||
    operator ||
    null;

  // Date + time (quite generic; works for most booking emails)
  const date = t.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );

  // Try to find two times near each other (e.g. "13:21 ... 14:56")
  const timeMatches = Array.from(t.matchAll(/\b(\d{1,2}:\d{2})\b/g)).map(
    (m) => m[1]
  );
  const depTime = timeMatches[0] ?? null;
  const arrTime = timeMatches[1] ?? null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (date) {
    const day = parseInt(date[1], 10);
    const monthIndex = MONTHS.indexOf(date[2].toLowerCase()) + 1;
    const year = parseInt(date[3], 10);
    depart_planned = toISOFromDateTime(year, monthIndex, day, depTime);
    arrive_planned = toISOFromDateTime(year, monthIndex, day, arrTime);
  }

  const trip: Trip = {
    retailer,
    operator,
    origin,
    destination,
    booking_ref: ref,
    depart_planned,
    arrive_planned,
  };
  trip.is_ticket = computeIsTicket(trip);
  return trip;
}

// ---- Fallback generic (used mainly so we don’t completely miss weird formats) ----
function parseGeneric(text: string): Trip {
  const t = text.replace(/\r/g, "");
  const od = t.match(
    /\b([A-Z][a-zA-Z\s&]+)\s+(?:to|->|-|–|—|→)\s+([A-Z][a-zA-Z\s&]+)\b/
  );
  const ref = t.match(/\b([A-Z0-9]{6,12})\b/); // very loose
  const trip: Trip = {
    origin: cleanStationName(od?.[1]?.trim() ?? null),
    destination: cleanStationName(od?.[2]?.trim() ?? null),
    booking_ref: ref?.[1] ?? null,
  };
  // GENERIC PARSER NEVER MARKS AS TICKET – we only use it as fallback signal
  trip.is_ticket = false;
  return trip;
}

// ---- Master parser ----
export function parseEmail(
  rawText: string,
  sender?: string,
  subject?: string
): Trip {
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
    /trainline|mytrainpal|thetrainline/i.test(sender || "") ||
    /Trainline|TrainPal/i.test(subject || "") ||
    /e-ticket|eticket|your ticket|your booking/i.test(subject || "")
  ) {
    const tl = parseTrainlineLike(text, sender, subject);
    if (tl.origin || tl.destination || tl.booking_ref) return tl;
  }

  // 3) Generic fallback – never marked as ticket on its own
  return parseGeneric(text);
}
