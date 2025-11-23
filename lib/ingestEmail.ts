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
      "- provider: brand that sold the ticket (TrainPal, Trainline, GWR, Avanti, Northern, etc.).\n" +
      "- retailer: use this for an intermediary like TrainPal/Trainline when the actual operator is another TOC.\n" +
      "- operator: the train operating company running the service (Avanti West Coast, West Midlands Railway, CrossCountry, Northern, Transport for Wales, etc.).\n\n" +
      "RULES:\n" +
      "- Only set is_ticket = true if this email clearly represents a BOOKED UK rail journey or e-ticket / booking confirmation.\n" +
      "- Subjects like \"Booking confirmation\", \"Your tickets\", \"Your GWR booking confirmation FR4KCNC4\" MUST be treated as tickets\n" +
      "  if they describe a journey such as \"Outward journey: 28 Dec 2025 departs Swansea at 23:27 ... arrives Neath 23:39\".\n" +
      "- If an aggregator (TrainPal / Trainline) sells a journey on another operator:\n" +
      "    * retailer = \"TrainPal\" or \"Trainline\" (etc.)\n" +
      "    * operator = e.g. \"West Midlands Railway\", \"Avanti West Coast\", \"CrossCountry\", \"Northern\", etc.\n" +
      "    * provider can be the same as retailer, or the operator – either is fine.\n" +
      "- For GWR-style e-mails where the text says something like\n" +
      "    \"Outward journey: 28 Dec 2025 departs Swansea at 23:27 travel by Train service provider Transport for Wales to Neath\",\n" +
      "  you MUST set is_ticket = true, origin = \"Swansea\", destination = \"Neath\",\n" +
      "  depart_planned = \"2025-12-28 23:27\" (or the closest parsable time string),\n" +
      "  and operator = \"Transport for Wales\" (provider/retailer can be \"GWR\").\n" +
      "- Many operators put the actual barcode or PDF attachment separately. As long as the email body describes a booked journey,\n" +
      "  treat it as is_ticket = true.\n" +
      "- If the email is primarily about Delay Repay, compensation, or a refund for a journey that ALREADY happened\n" +
      "  (even if it describes the past journey), you MUST set is_ticket = false and give an ignore_reason like\n" +
      "  \"delay_compensation_email\".\n" +
      "- If you are genuinely unsure whether it's a ticket vs marketing/compensation, prefer is_ticket = false\n" +
      "  with a clear ignore_reason.\n\n" +
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
  } catch (e) {
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
  const requiredString = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;

  // Normalise provider-ish string for gating
  const providerLike =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    null;

  // 3) Lighter gate – we only *require* provider + origin + destination.
  const hasBasicTrip =
    requiredString(providerLike) &&
    requiredString(parsed.origin) &&
    requiredString(parsed.destination);

  if (!hasBasicTrip) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  // 4) Valid usable ticket → build a strongly-typed result
  const operator =
    (parsed.operator && parsed.operator.trim()) || null;

  const retailer =
    (parsed.retailer && parsed.retailer.trim()) || null;

  const provider =
    operator ||
    (parsed.provider && parsed.provider.trim()) ||
    retailer ||
    "UNKNOWN";

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
