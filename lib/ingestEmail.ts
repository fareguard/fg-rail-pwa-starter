// lib/ingestEmail.ts

import openai from "@/lib/openai";
import type { ParsedTicketResult, ParseTrainEmailOutput } from "./trainEmailFilter";

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

// Helper: strip code fences / extra text and extract the JSON object
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

  // ---- Ask the model to return STRICT JSON (no markdown, no prose) ----
  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input:
      "You are a strict train ticket email parser for a UK train-delay-refund app.\n" +
      "Return ONLY a JSON object, no explanation, no markdown.\n" +
      "Shape:\n" +
      "{\n" +
      '  \"is_ticket\": boolean,\n' +
      '  \"ignore_reason\"?: string,\n' +
      '  \"provider\"?: string,\n' +
      '  \"booking_ref\"?: string,\n' +
      '  \"origin\"?: string,\n' +
      '  \"destination\"?: string,\n' +
      '  \"depart_planned\"?: string,\n' +
      '  \"arrive_planned\"?: string,\n' +
      '  \"outbound_departure\"?: string\n' +
      "}\n\n" +
      "- Only set is_ticket = true if this clearly contains a UK train e-ticket or journey confirmation\n" +
      "  (Trainline, TrainPal, National Rail, Avanti West Coast, West Midlands Railway, Northern, etc.).\n" +
      "- For TrainPal subjects like 'TrainPal: Booking Confirmation: Birmingham New Street ↔ Cannock',\n" +
      "  set provider = 'TrainPal', origin = 'Birmingham New Street', destination = 'Cannock'.\n" +
      "- booking_ref is OPTIONAL. If you can't confidently find one, leave it empty or null.\n" +
      "- depart_planned / outbound_departure should be the first departure time if you can find it,\n" +
      "  but leave them empty if unsure.\n" +
      "- If it's marketing, receipts, general account stuff, or unclear, set is_ticket = false and give a clear ignore_reason.\n\n" +
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

  // 1) Not a ticket → ignore
  if (!parsed.is_ticket) {
    return {
      is_ticket: false,
      ignore_reason: parsed.ignore_reason || "model_says_not_a_ticket",
    };
  }

  // Helper — require non-empty strings
  const requiredString = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;

  // 2) Lighter gate – we only *require* provider + origin + destination.
  const hasBasicTrip =
    requiredString(parsed.provider) &&
    requiredString(parsed.origin) &&
    requiredString(parsed.destination);

  if (!hasBasicTrip) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  // 3) Valid usable ticket → return strong typed result
  //    Fill in missing optional fields with safe fallbacks so types stay happy.
  const provider = parsed.provider!.trim();
  const origin = parsed.origin!.trim();
  const destination = parsed.destination!.trim();

  const booking_ref =
    (parsed.booking_ref && parsed.booking_ref.trim()) || "UNKNOWN";

  const depart_planned =
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    (parsed.outbound_departure && parsed.outbound_departure.trim()) ||
    "UNKNOWN";

  const outbound_departure =
    (parsed.outbound_departure && parsed.outbound_departure.trim()) ||
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    "UNKNOWN";

  const arrive_planned =
    (parsed.arrive_planned && parsed.arrive_planned.trim()) || null;

  return {
    is_ticket: true,
    provider,
    booking_ref,
    origin,
    destination,
    depart_planned,
    arrive_planned,
    outbound_departure,
  };
}
