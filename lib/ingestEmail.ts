// lib/ingestEmail.ts

import openai from "@/lib/openai";
import type {
  ParsedTicketResult,
  ParseTrainEmailOutput,
} from "./trainEmailFilter";

export type IngestEmailArgs = {
  id?: string;
  subject: string;
  from: string;

  // what route.ts is passing
  body_plain?: string | null;
  snippet?: string | null;

  // legacy / future-proof fields (safe to keep)
  bodyHtml?: string | null;
  bodyText?: string | null;
};

// ---------------------------------------------------------------------------
// Helper: strip code fences / extra text and extract the JSON object
// ---------------------------------------------------------------------------
function extractJsonObject(raw: string): string {
  if (!raw) throw new Error("empty_raw_text");

  let text = raw.trim();

  // Remove ```json / ``` fences if present
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

// ---------------------------------------------------------------------------
// Very cheap pre-filter: obvious Delay Repay / compensation e-mails
// These should NOT create trips, even if they mention a journey.
// ---------------------------------------------------------------------------
const DELAY_EMAIL_KEYWORDS = [
  "delay repay",
  "delayrepay",
  "compensation for your delayed",
  "compensation for your journey",
  "your claim has been approved",
  "your claim has been processed",
  "we have processed your claim",
  "we have sent your compensation",
  "we're sorry your train was delayed",
  "we are sorry your train was delayed",
  "we apologise that your train was delayed",
  "delay compensation",
];

function looksLikeDelayEmail(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return DELAY_EMAIL_KEYWORDS.some((k) => text.includes(k));
}

// ---------------------------------------------------------------------------

export async function ingestEmail({
  id,
  subject,
  from,
  body_plain,
  snippet,
  bodyHtml,
  bodyText,
}: IngestEmailArgs): Promise<ParsedTicketResult> {
  // Prefer the richest text we have, but always fall back to *something*
  const body =
    bodyText ||
    bodyHtml ||
    body_plain ||
    snippet ||
    "";

  // 0) Hard block obvious Delay Repay / compensation e-mails
  if (looksLikeDelayEmail(subject, body)) {
    return {
      is_ticket: false,
      ignore_reason: "delay_or_compensation_email",
    };
  }

  // 1) Ask the model to return STRICT JSON (no markdown, no prose)
  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input:
      "You are a strict UK train ticket email parser for a train-delay-refund app.\n" +
      "Return ONLY a single JSON object, no explanation, no markdown.\n\n" +
      "JSON shape:\n" +
      "{\n" +
      '  \"is_ticket\": boolean,\n' +
      '  \"ignore_reason\"?: string,\n' +
      '  \"provider\"?: string,\n' +
      '  \"retailer\"?: string,\n' +
      '  \"operator\"?: string,\n' +
      '  \"booking_ref\"?: string,\n' +
      '  \"origin\"?: string,\n' +
      '  \"destination\"?: string,\n' +
      '  \"depart_planned\"?: string,\n' +
      '  \"arrive_planned\"?: string,\n' +
      '  \"outbound_departure\"?: string\n' +
      "}\n\n" +
      "DEFINITIONS:\n" +
      "- provider: brand that sold the ticket (TrainPal, Trainline, GWR, Avanti, Northern, ScotRail, c2c, etc.).\n" +
      "- retailer: intermediary like TrainPal/Trainline when the actual operator is another TOC.\n" +
      "- operator: the train operating company running the service (Avanti West Coast, West Midlands Railway,\n" +
      "  CrossCountry, Northern, Transport for Wales, GWR, SWR, ScotRail, etc.).\n\n" +
      "WHAT COUNTS AS A TICKET:\n" +
      "- Booking confirmation / e-ticket emails that clearly describe a *booked* UK rail journey.\n" +
      "- Typical phrases: \"Your booking confirmation\", \"Your trip to X is confirmed\", \"Your GWR booking confirmation 9HFGG44C\",\n" +
      "  \"Journey: 1 Dawlish to Starcross @ £2.00\", \"Outward journey: 19 Jan 2026 departs Dawlish at 20:13 ... arrives 20:21\".\n" +
      "- These MUST be treated as tickets (is_ticket = true) if you can identify origin, destination and a departure date/time.\n\n" +
      "WHAT **IS NOT** A TICKET:\n" +
      "- Pure registration / account emails (\"Thank you for registering\", \"Activate your account\").\n" +
      "- Pure marketing.\n" +
      "- Pure Delay Repay / compensation e-mails (already filtered, but keep them as is_ticket = false if you see one).\n" +
      "- E-mails that only say \"your e-tickets are attached\" without any journey details (no origin/destination or times).\n\n" +
      "RULES:\n" +
      "- Only set is_ticket = true if this specific e-mail clearly represents a BOOKED UK rail journey.\n" +
      "- If an aggregator (TrainPal / Trainline) sells a journey on another operator:\n" +
      "    * retailer = \"TrainPal\" or \"Trainline\" (etc.)\n" +
      "    * operator = the TOC running the train (e.g. \"Northern\", \"Avanti West Coast\").\n" +
      "    * provider can be either the retailer or the operator.\n" +
      "- If the body contains a line like \"Journey: 1 <ORIGIN> to <DESTINATION> ...\" and an \"Outward journey\" date,\n" +
      "  and a phrase like \"departs <ORIGIN> at HH:MM ... arrives ...\", you SHOULD treat it as a ticket.\n" +
      "- If you are unsure whether it's a ticket vs marketing/compensation, prefer is_ticket = false with a clear ignore_reason.\n\n" +
      `EMAIL METADATA:\nEmail-ID: ${id || "unknown"}\nFrom: ${from}\nSubject: ${subject}\n\nEMAIL BODY:\n${body}`,
  });

  // Try to get the text output in a version-agnostic way
  const rawText =
    (completion as any).output_text ||
    (completion as any).output?.[0]?.content?.[0]?.text ||
    "";

  let parsed: ParseTrainEmailOutput;

  try {
    const jsonStr = extractJsonObject(rawText);
    parsed = JSON.parse(jsonStr) as ParseTrainEmailOutput;
  } catch {
    // If the model somehow didn't give valid JSON, fail safely
    return {
      is_ticket: false,
      ignore_reason: "model_json_parse_error",
    };
  }

  // 2) Not a ticket → ignore
  if (!parsed.is_ticket) {
    return {
      is_ticket: false,
      ignore_reason: parsed.ignore_reason || "model_says_not_a_ticket",
    };
  }

  // Helper — require non-empty strings
  const nonEmpty = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;

  // Normalise provider-ish string for gating
  const providerLike =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    null;

  // We now require: provider + origin + destination + *some* departure time,
  // otherwise we treat it as too weak (this kills the “Departs — / no time” junk).
  const hasBasicTrip =
    nonEmpty(providerLike) &&
    nonEmpty(parsed.origin) &&
    nonEmpty(parsed.destination);

  const hasDepartureTime =
    nonEmpty(parsed.depart_planned) || nonEmpty(parsed.outbound_departure);

  if (!hasBasicTrip || !hasDepartureTime) {
    return {
      is_ticket: false,
      ignore_reason: !hasBasicTrip
        ? "missing_basic_fields_for_dashboard"
        : "missing_departure_time",
    };
  }

  // 3) Valid usable ticket → return strong typed result
  const provider =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    "UNKNOWN";

  const retailer =
    (parsed.retailer && parsed.retailer.trim()) || null;

  const operator =
    (parsed.operator && parsed.operator.trim()) || null;

  const origin = parsed.origin!.trim();
  const destination = parsed.destination!.trim();

  const booking_ref =
    (parsed.booking_ref && parsed.booking_ref.trim()) || "UNKNOWN";

  const depart_planned =
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    (parsed.outbound_departure && parsed.outbound_departure.trim()) ||
    null;

  const outbound_departure =
    (parsed.outbound_departure && parsed.outbound_departure.trim()) ||
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    null;

  const arrive_planned =
    (parsed.arrive_planned && parsed.arrive_planned.trim()) || null;

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
