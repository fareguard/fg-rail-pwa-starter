// lib/parsers.ts
export type ParsedTrip = {
  retailer?: string;
  operator?: string;
  booking_ref?: string;
  origin?: string;
  destination?: string;
  depart_planned?: string; // ISO
  arrive_planned?: string; // ISO
};

// SUPER-simple parser: handles Trainline / Avanti style text
export function parseEmail(subject: string, body: string): ParsedTrip | null {
  const text = `${subject}\n${body}`.replace(/\r/g, "");
  if (!/ticket|e-?ticket/i.test(text)) return null;

  const p: ParsedTrip = {};
  if (/trainline/i.test(text)) p.retailer = "trainline";
  if (/avanti/i.test(text)) p.operator = "Avanti West Coast";

  const ref = text.match(/\b([A-Z0-9]{6,8})\b.*(Booking|Reference)/i)?.[1]
           || text.match(/Booking\s+reference[:\s]+([A-Z0-9\-]+)/i)?.[1];
  if (ref) p.booking_ref = ref;

  const leg = text.match(/From\s+(.+?)\s+to\s+(.+?)\b/i);
  if (leg) {
    p.origin = leg[1].trim();
    p.destination = leg[2].trim();
  }

  const dep = text.match(/Depart[^\d]*(\d{1,2}:\d{2}).*?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+\w+\s+\d{4})/i);
  const arr = text.match(/Arriv[ea][^\d]*(\d{1,2}:\d{2}).*?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+\w+\s+\d{4})/i);

  function toIso(time: string, date: string) {
    const d = new Date(`${date.replace(/\./g,"")} ${time}`);
    return isNaN(+d) ? undefined : d.toISOString();
  }

  if (dep) p.depart_planned = toIso(dep[1], dep[2]);
  if (arr) p.arrive_planned = toIso(arr[1], arr[2]);

  // must have at least origin,destination or booking_ref
  if (!p.booking_ref && !(p.origin && p.destination)) return null;
  return p;
}
