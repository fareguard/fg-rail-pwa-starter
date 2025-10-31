function parseAvantiEmail(text: string) {
  const t = text.replace(/\r/g, "");

  // booking ref: Avanti uses numeric refs too
  const refMatch = t.match(/Booking reference:\s*([A-Z0-9]{6,12}|\d{6,12})/i);
  const booking_ref = refMatch?.[1]?.trim() ?? null;

  // origin/destination
  // e.g. "Wolverhampton to Birmingham Stations / Single £ 1.75"
  const od1 = t.match(/\b([A-Za-z][A-Za-z\s&]+?)\s+to\s+([A-Za-z][A-Za-z\s&]+?)\s*(?:\/|£|\n)/i);
  // or explicit legs:
  // "Wolverhampton (18:45) ... Birmingham New Street (19:07)"
  const leg = t.match(/([A-Za-z][A-Za-z\s&]+?)\s*\(\d{1,2}:\d{2}\)[\s\S]+?([A-Za-z][A-Za-z\s&]+?)\s*\(\d{1,2}:\d{2}\)/i);

  const origin = (od1?.[1] || leg?.[1])?.trim() ?? null;
  const destination = (od1?.[2] || leg?.[2])?.trim() ?? null;

  // operator
  const operator = /Avanti West Coast/i.test(t) ? "Avanti West Coast" : null;
  const retailer = operator;

  // date/time
  // e.g. "Outward journey\n31 October 2025" + "Wolverhampton 18:45 ... Birmingham New Street 19:07"
  const dateMatch = t.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  const depTime = t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Wolverhampton|\(18:45\)|\bDepart)/i)?.[1]
               || t.match(/Wolverhampton\s*(\d{1,2}:\d{2})/i)?.[1];
  const arrTime = t.match(/\b(\d{1,2}:\d{2})\b(?=[^\n]*Birmingham|\(19:07\)|\bArrive)/i)?.[1]
               || t.match(/Birmingham(?:\sNew Street)?\s*(\d{1,2}:\d{2})/i)?.[1];

  function toISO(y:number,m:number,d:number,time?:string) {
    if (!time) return null;
    // UK was on GMT (UTC+0) on 31 Oct 2025
    const [hh,mm] = time.split(":").map(Number);
    return new Date(Date.UTC(y, m-1, d, hh, mm)).toISOString();
  }

  let depart_planned: string | null = null;
  let arrive_planned: string | null = null;
  if (dateMatch) {
    const day = parseInt(dateMatch[1],10);
    const monthName = dateMatch[2].toLowerCase();
    const year = parseInt(dateMatch[3],10);
    const monthIndex = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(monthName)+1;
    depart_planned = toISO(year, monthIndex, day, depTime || undefined);
    arrive_planned = toISO(year, monthIndex, day, arrTime || undefined);
  }

  return {
    retailer, operator, origin, destination, booking_ref,
    depart_planned, arrive_planned
  };
}
