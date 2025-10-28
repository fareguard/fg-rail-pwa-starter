export type ParsedTrip = {
  retailer?: string | null;
  operator?: string | null;
  booking_ref?: string | null;
  origin?: string | null;
  destination?: string | null;
  depart_planned?: string | null;   // ISO string (we'll toISOString() later)
  arrive_planned?: string | null;
};

const STATION_WORD = /[A-Za-z][A-Za-z\s'&-]{2,}/;
const ORIGIN_DEST = new RegExp(`\\b(${STATION_WORD.source})\\s+(?:to|->)\\s+(${STATION_WORD.source})\\b`, "i");
//  24/10/2025 07:15  or  07:15 – 10:38 on 27/10/2025
const DATE = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
const TIMES = /(\d{1,2}[:.]\d{2})\s*(?:–|-|to)\s*(\d{1,2}[:.]\d{2})/;
const BOOKING_REF = /\b([A-Z0-9]{6,8})\b/;

function toIso(dateStr?: string | null, timeStr?: string | null) {
  if (!dateStr || !timeStr) return null;
  // normalise date dd/mm/yyyy (UK)
  const [d, m, yRaw] = dateStr.split(/[\/\-]/);
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  const [hh, mm] = timeStr.replace(".", ":").split(":");
  const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/** Parse a ticket/itinerary-like email body & subject into a minimal trip */
export function parseEmail(subject: string = "", body: string = ""): ParsedTrip {
  const text = `${subject}\n${body}`;

  const od = text.match(ORIGIN_DEST);
  const date = text.match(DATE)?.[1] ?? null;
  const times = text.match(TIMES);
  const ref = text.match(BOOKING_REF)?.[1] ?? null;

  const origin = od?.[1]?.trim() ?? null;
  const destination = od?.[2]?.trim() ?? null;
  const depart = toIso(date, times?.[1] ?? null);
  const arrive = toIso(date, times?.[2] ?? null);

  // cheap retailer/operator guesses
  const retailer =
    /trainline/i.test(text) ? "trainline" :
    /splitmyfare/i.test(text) ? "splitmyfare" :
    /rails?martr?/i.test(text) ? "railsmartr" :
    /lner/i.test(text) ? "lner" :
    /avanti/i.test(text) ? "avanti" :
    /gwr/i.test(text) ? "gwr" :
    null;

  const operator =
    /avanti/i.test(text) ? "Avanti West Coast" :
    /lner/i.test(text) ? "LNER" :
    /gwr/i.test(text) ? "GWR" :
    /cross\s*country/i.test(text) ? "CrossCountry" :
    null;

  return {
    retailer,
    operator,
    booking_ref: ref,
    origin,
    destination,
    depart_planned: depart,
    arrive_planned: arrive,
  };
}
