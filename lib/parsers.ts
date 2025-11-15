// lib/parsers.ts
// Parses rail ticket emails into structured trip info.

export type Trip = {
  retailer?: string | null;
  operator?: string | null;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
  is_ticket?: boolean; // <-- only "true" means real ticket
};

// ---- Helpers ----

const MONTH_MAP: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function toISOFromDateTime(
  day: number,
  monthIndex1to12: number,
  year: number,
  time?: string | null
) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(year, monthIndex1to12 - 1, day, hh, mm)).toISOString();
}

// Very forgiving date matcher for things like:
//  - 30 August 2025
//  - 30 Aug 2025
//  - Sat, 30 Aug 2025
//  - Sat, Aug 30, 2025
function findDateParts(text: string): { day: number; monthIndex: number; year: number } | null {
  const t = text.replace(/\r/g, "");

  // 1) 30 August 2025 / 30 Aug 2025
  let m =
    t.match(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(20\d{2})\b/i
    );
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIndex = MONTH_MAP[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (monthIndex) return { day, monthIndex, year };
  }

  // 2) Sat, 30 Aug 2025
  m = t.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(20\d{2})\b/i
  );
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIndex = MONTH_MAP[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (monthIndex) return { day, monthIndex, year };
  }

  // 3) Sat, Aug 30, 2025
  m = t.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s*(20\d{2})\b/i
  );
  if (m) {
    const monthIndex = MONTH_MAP[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (monthIndex) return { day, monthIndex, year };
  }

  return null;
}

// Normalise station-ish text (strip obvious boilerplate)
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

// Only call something a "ticket" if it looks like a real journey
function computeIsTicket(trip: Trip): boolean {
  return !!(trip.origin && trip.destination && trip.depart_planned);
}

// ---- Avanti West Coast ----

function parseAvantiEmail(text: string): Trip {
  const t = text.replace(/\r/g, "");

  const refMatch = t.match(/Booking reference:\s*([A-Z0-9]{6,12}|\d{6,12})/i);
  const booking_ref = refMatch?.[1]?.trim() ?? null;

  // All "X to Y" pairs, take the last one (closest to ticket summary)
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

  const operator = /Avanti West Coast/i.test(t) ? "Avanti West Coast" : null;
  const retailer = operator;

  const dateParts = findDateParts(t);
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
  if (dateParts) {
    depart_planned = toISOFromDateTime(
      dateParts.day,
      dateParts.monthIndex,
      dateParts.year,
      depTime
    );
    arrive_planned = toISOFromDateTime(
      dateParts.day,
      dateParts.monthIndex,
      dateParts.year,
      arrTime
    );
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

  const ref =
    t.match(/Booking (?:number|reference)[:\s]+([A-Z0-9]{6,20}|\d{6,20})/i)?.[1] ??
    t.match(/Reference[:\s]+([A-Z0-9]{6,20}|\d{6,20})/i)?.[1] ??
    null;

  // Origin / destination: X to Y / X -> Y / X - Y / X → Y / X ↔ Y
  const od =
    t.match(
      /\b([A-Z][a-zA-Z\s&]+?)\s+(?:to|->|-|–|—|→|↔)\s+([A-Z][a-zA-Z\s&]+?)\b/
    ) ??
    t.match(/From[:\s]+([A-Z][a-zA-Z\s&]+)\s+to[:\s]+([A-Z][a-zA-Z\s&]+)/i);

  const origin = cleanStationName(od?.[1]?.trim() ?? null);
  const destination = cleanStationName(od?.[2]?.trim() ?? null);

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

  const retailer =
    (sender?.includes("trainline.com") && "Trainline") ||
    (sender?.includes("mytrainpal.com") && "TrainPal") ||
    (subject && /Trainline/i.test(subject) && "Trainline") ||
    (subject && /TrainPal/i.test(subject) && "TrainPal") ||
    operator ||
    null;

  const date = findDateParts(t);

  const timeMatches = Array.from(t.matchAll(/\b(\d{1,2}:\d{2})\b/g)).map(
    (m) => m[1]
  );
  const depTime = timeMatches[0] ?? null;
  const arrTime = timeMatches[1] ?? null;

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (date) {
    depart_planned = toISOFromDateTime(
      date.day,
      date.monthIndex,
      date.year,
      depTime
    );
    arrive_planned = toISOFromDateTime(
      date.day,
      date.monthIndex,
      date.year,
      arrTime
    );
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

// ---- Fallback generic ----

function parseGeneric(text: string): Trip {
  const t = text.replace(/\r/g, "");
  const od = t.match(
    /\b([A-Z][a-zA-Z\s&]+)\s+(?:to|->|-|–|—|→|↔)\s+([A-Z][a-zA-Z\s&]+)\b/
  );
  const ref = t.match(/\b([A-Z0-9]{6,12})\b/); // very loose
  const trip: Trip = {
    origin: cleanStationName(od?.[1]?.trim() ?? null),
    destination: cleanStationName(od?.[2]?.trim() ?? null),
    booking_ref: ref?.[1] ?? null,
  };
  trip.is_ticket = false; // generic never marks as ticket
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

  // 3) Generic fallback – signal only, never a true ticket
  return parseGeneric(text);
}
