// lib/ingestEmail.ts

import openai from "@/lib/openai";
import type { ParsedTicketResult, ParseTrainEmailOutput } from "./trainEmailFilter";

export type IngestEmailArgs = {
  id?: string;
  subject: string;
  from: string;

  // from Gmail route
  body_plain?: string | null;
  snippet?: string | null;

  // legacy / future-proof
  bodyHtml?: string | null;
  bodyText?: string | null;
};

// strip ``` fences etc and pull out the JSON object
function extractJsonObject(raw: string): string {
  if (!raw) throw new Error("empty_raw_text");

  let text = raw.trim();

  text = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("no_json_braces_found");
  }

  return text.slice(firstBrace, lastBrace + 1);
}

export async function ingestEmail({
  id,
  subject,
  from,
  body_plain,
  snippet,
  bodyHtml,
  bodyText,
}: IngestEmailArgs): Promise<ParsedTicketResult> {
  const body =
    bodyText ||
    bodyHtml ||
    body_plain ||
    snippet ||
    "";

  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input:
      "You are a strict UK train e-ticket parser for a Delay Repay automation app.\n" +
      "Return ONLY a single JSON object, no prose, no markdown.\n\n" +
      "Fields:\n" +
      "{\n" +
      '  \"is_ticket\": boolean,\n' +
      '  \"ignore_reason\"?: string,\n' +
      '\n' +
      '  \"provider\"?: string,    // high-level brand on the email (\"TrainPal\", \"Trainline\", \"GWR\", \"Avanti West Coast\")\n' +
      '  \"retailer\"?: string,    // website / app the passenger bought from (often same as provider)\n' +
      '  \"operator\"?: string,    // train company running the service (\"Avanti West Coast\", \"CrossCountry\", \"West Midlands Railway\", \"Northern\", \"GWR\", \"Transport for Wales\", etc.)\n' +
      '\n' +
      '  \"booking_ref\"?: string,\n' +
      '  \"origin\"?: string,      // station name for the first leg (e.g. \"Birmingham New Street\")\n' +
      '  \"destination\"?: string, // final station (e.g. \"London Euston\")\n' +
      '  \"depart_planned\"?: string,      // planned departure date/time as seen in the email\n' +
      '  \"arrive_planned\"?: string,      // planned arrival date/time if present\n' +
      '  \"outbound_departure\"?: string   // same as depart_planned, can be left empty if unsure\n' +
      "}\n\n" +
      "- Only set is_ticket = true if this email clearly contains a UK rail e-ticket or booking confirmation.\n" +
      "- Marketing, newsletters, generic account emails etc must be is_ticket = false with a helpful ignore_reason.\n" +
      "- For aggregator emails like TrainPal / Trainline:\n" +
      "    • provider = brand on the email (\"TrainPal\", \"Trainline\").\n" +
      "    • retailer = same as provider.\n" +
      "    • operator = the underlying rail company mentioned (\"West Midlands Railway\", \"Avanti West Coast\", etc.).\n" +
      "- For operator-direct emails (Avanti, CrossCountry, GWR, Northern, etc.):\n" +
      "    • provider = operator brand (e.g. \"CrossCountry\").\n" +
      "    • retailer = same string.\n" +
      "    • operator = same string.\n" +
      "- If you see wording like \"Valid on booked TfW services only\" then operator = \"Transport for Wales\".\n" +
      "- If you cannot confidently find a booking_ref, leave it empty or null.\n" +
      "- If you cannot confidently find times, leave the *_planned fields empty or null (do NOT hallucinate).\n\n" +
      `EMAIL METADATA:\nEmail-ID: ${id || "unknown"}\nFrom: ${from}\nSubject: ${subject}\n\nEMAIL BODY:\n${body}`,
  });

  const rawText =
    (completion as any).output_text ||
    (completion as any).output?.[0]?.content?.[0]?.text ||
    "";

  let parsedJson: ParseTrainEmailOutput;

  try {
    const jsonStr = extractJsonObject(rawText);
    parsedJson = JSON.parse(jsonStr) as ParseTrainEmailOutput;
  } catch {
    return {
      is_ticket: false,
      ignore_reason: "model_json_parse_error",
    };
  }

  // Not a ticket -> bail
  if (!parsedJson.is_ticket) {
    return {
      is_ticket: false,
      ignore_reason:
        (parsedJson as any).ignore_reason || "model_says_not_a_ticket",
    };
  }

  const p = parsedJson as any;

  const clean = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s.length ? s : null;
  };

  // Canonicalise brands a bit
  const provider =
    clean(p.provider) ||
    clean(p.retailer) ||
    clean(p.operator) ||
    "UNKNOWN";

  const retailer = clean(p.retailer) || provider;
  const operator = clean(p.operator) || provider;

  const origin = clean(p.origin);
  const destination = clean(p.destination);

  if (!origin || !destination) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  const booking_ref = clean(p.booking_ref) || "UNKNOWN";

  const depart_planned =
    clean(p.depart_planned) || clean(p.outbound_departure) || "UNKNOWN";

  const outbound_departure =
    clean(p.outbound_departure) || clean(p.depart_planned) || "UNKNOWN";

  const arrive_planned = clean(p.arrive_planned);

  return {
    is_ticket: true,
    provider,
    retailer,
    operator,
    booking_ref,
    origin,
    destination,
    depart_planned,
    arrive_planned,
    outbound_departure,
  };
}
