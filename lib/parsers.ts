// lib/parsers.ts
// 🧠 Responsible for scanning email text and extracting train trip info.

function parseAvantiEmail(text: string) {
  const t = text.replace(/\r/g, "");

  // booking ref: Avanti uses numeric refs too
  const refMatch = t.match(/Booking reference:\s*([A-Z0-9]{6,12}|\d{6,12})/i);
  const booking_ref = refMatch?.[1]?.trim() ?? null;

  // origin/destination
  const od1 = t.match(/\b([A-Za-z][A-Za-z\s&]+?)\s+to\s+([A-Za-z][A-Za-z\s&]+?)\s*(?:\/|£|\n)/i);
  const leg = t.match(/([A-Za-z][A-Za-z\s&]+?)\s*\(\d{1,2}:\d{2}\)[\s\S]+?([A-Za-z][A-Za-z\s&]+?)\s*\(\d{1,2}:\d{2}\)/i);

  const origin = (od1?.[1] || leg?.[1])?.trim() ?? null;
  const destination = (od1?.[2] || leg?.[2])?.trim() ?? null;

  // operator
  const operator = /Avanti West Coast/i.test(t) ? "Avanti West Coast" : null;
  const retailer = operator;

  // date/time
  const dateMatch = t.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  const depTime =
    t.match(/Wolverhampton\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Depart)/i)?.[1];
  const arrTime =
    t.match(/Birmingham(?:\sNew Street)?\s*(\d{1,2}:\d{2})/i)?.[1] ??
    t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Arrive)/i)?.[1];

  function toISO(y: number, m: number, d: number, time?: string) {
    if (!time) return null;
    const [hh, mm] = time.split(":").map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mm)).toISOString();
  }

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2].toLowerCase();
    const year = parseInt(dateMatch[3], 10);
    const monthIndex =
      [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
      ].indexOf(monthName) + 1;
    depart_planned = toISO(year, monthIndex, day, depTime);
    arrive_planned = toISO(year, monthIndex, day, arrTime);
  }

  return {
    retailer,
    operator,
    origin,
    destination,
    booking_ref,
    depart_planned,
    arrive_planned,
  };
}

// 🧩 Master email parser
export function parseEmail(rawText: string, sender?: string, subject?: string) {
  const text = rawText.replace(/\r/g, "");
  const trip: Record<string, any> = {};

  // --- Avanti West Coast ---
  if (
    /avanti/i.test(text) ||
    /@avantiwestcoast\.co\.uk/i.test(sender || "") ||
    /Your booking is confirmed/i.test(subject || "")
  ) {
    const p = parseAvantiEmail(text);
    trip.retailer = trip.retailer || p.retailer;
    trip.operator = trip.operator || p.operator;
    trip.origin = trip.origin || p.origin;
    trip.destination = trip.destination || p.destination;
    trip.booking_ref = trip.booking_ref || p.booking_ref;
    trip.depart_planned = trip.depart_planned || p.depart_planned;
    trip.arrive_planned = trip.arrive_planned || p.arrive_planned;
  }

  // --- (Optional) fallback generic regexes ---
  if (!trip.origin) {
    const genOD = text.match(/\b([A-Z][a-zA-Z\s]+)\s+to\s+([A-Z][a-zA-Z\s]+)\b/);
    if (genOD) {
      trip.origin = genOD[1].trim();
      trip.destination = genOD[2].trim();
    }
  }

  return trip;
}
