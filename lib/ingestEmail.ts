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

  // from Gmail
  body_plain?: string | null;
  snippet?: string | null;

  // older / fallback fields
  bodyHtml?: string | null;
  bodyText?: string | null;
};

// -------------------------------------------------------------
// Helper to extract clean JSON from LLM output
// -------------------------------------------------------------
function extractJsonObject(raw: string): string {
  if (!raw) throw new Error("empty_raw_text");

  let text = raw.trim();

  text = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("no_json_braces_found");
  }

  return text.slice(first, last + 1);
}

// -------------------------------------------------------------
// Delay Repay / compensation filter
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// Main ingestion
// -------------------------------------------------------------
export async function ingestEmail({
  id,
  subject,
  from,
  body_plain,
  snippet,
  bodyHtml,
  bodyText,
}: IngestEmailArgs): Promise<ParsedTicketResult> {
  // Prefer richest field
  const body =
    bodyText ||
    bodyHtml ||
    body_plain ||
    snippet ||
    "";

  // 0) Automatic ignore for delay-repay emails
  if (looksLikeDelayEmail(subject, body)) {
    return {
      is_ticket: false,
      ignore_reason: "delay_or_compensation_email",
    };
  }

  // 1) Ask OpenAI for strict JSON
  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input:
      "You are a strict UK rail-ticket email parser. Return ONLY raw JSON.\n\n" +
      "JSON shape:\n" +
      "{\n" +
      '  "is_ticket": boolean,\n' +
      '  "ignore_reason"?: string,\n' +
      '  "provider"?: string,\n' +
      '  "retailer"?: string,\n' +
      '  "operator"?: string,\n' +
      '  "booking_ref"?: string,\n' +
      '  "origin"?: string,\n' +
      '  "destination"?: string,\n' +
      '  "depart_planned"?: string,\n' +
      '  "arrive_planned"?: string,\n' +
      '  "outbound_departure"?: string\n' +
      "}\n\n" +
      "RULES:\n" +
      "- Treat e-ticket or booking confirmation emails as tickets.\n" +
      "- Accept ANY UK operator or retailer (GWR, SWR, ScotRail, Avanti, Trainline, TrainPal, Northern, WMR, etc.).\n" +
      "- If a journey is described with a date + time + origin + destination, set is_ticket = true.\n" +
      "- Never include markdown or prose. Only JSON.\n\n" +
      `EMAIL METADATA:\nFrom: ${from}\nSubject: ${subject}\n\nBODY:\n${body}`,
  });

  const rawText =
    (completion as any).output_text ||
    (completion as any).output?.[0]?.content?.[0]?.text ||
    "";

  let parsed: ParseTrainEmailOutput;
  try {
    const jsonStr = extractJsonObject(rawText);
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      is_ticket: false,
      ignore_reason: "model_json_parse_error",
    };
  }

  // 2) If LLM says it's not a ticket → ignore
  if (!parsed.is_ticket) {
    return {
      is_ticket: false,
      ignore_reason: parsed.ignore_reason || "model_says_not_a_ticket",
    };
  }

  // Helper: must be non-empty string
  const nonEmpty = (v: any) =>
    typeof v === "string" && v.trim().length > 0;

  // 3) Minimal gating: require provider + origin + destination
  const providerLike =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    null;

  if (!nonEmpty(providerLike) || !nonEmpty(parsed.origin) || !nonEmpty(parsed.destination)) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  // Normalise final fields to match ParsedTicketResult
  const provider =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    "UNKNOWN";

  const retailer = nonEmpty(parsed.retailer) ? parsed.retailer!.trim() : null;
  const operator = nonEmpty(parsed.operator) ? parsed.operator!.trim() : null;

  const origin = parsed.origin!.trim();
  const destination = parsed.destination!.trim();

  const booking_ref =
    nonEmpty(parsed.booking_ref) ? parsed.booking_ref!.trim() : "UNKNOWN";

  const depart_planned =
    (nonEmpty(parsed.depart_planned) && parsed.depart_planned!.trim()) ||
    (nonEmpty(parsed.outbound_departure) && parsed.outbound_departure!.trim()) ||
    null;

  const outbound_departure =
    (nonEmpty(parsed.outbound_departure) && parsed.outbound_departure!.trim()) ||
    (nonEmpty(parsed.depart_planned) && parsed.depart_planned!.trim()) ||
    null;

  const arrive_planned =
    (nonEmpty(parsed.arrive_planned) && parsed.arrive_planned!.trim()) ||
    null;

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
