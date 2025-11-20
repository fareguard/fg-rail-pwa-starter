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

  // Ask the model to return STRICT JSON (no markdown, no prose)
  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input:
      "You are a strict train ticket email parser for a UK train-delay-refund app.\n" +
      "Return ONLY a JSON object, no explanation, no markdown.\n" +
      "Shape:\n" +
      "{\n" +
      '  "is_ticket": boolean,\n' +
      '  "ignore_reason"?: string,\n' +
      '  "provider"?: string,\n' +
      '  "booking_ref"?: string,\n' +
      '  "origin"?: string,\n' +
      '  "destination"?: string,\n' +
      '  "depart_planned"?: string,\n' +
      '  "arrive_planned"?: string,\n' +
      '  "outbound_departure"?: string\n' +
      "}\n\n" +
      "Only set is_ticket=true if this clearly contains a UK train e-ticket or journey confirmation " +
      "(Trainline, National Rail, Avanti, West Midlands Railway, Northern, etc.).\n" +
      "If it's marketing, receipts, general account stuff, or unclear, set is_ticket=false and give a clear ignore_reason.\n\n" +
      `EMAIL METADATA:\nEmail-ID: ${id || "unknown"}\nFrom: ${from}\nSubject: ${subject}\n\nEMAIL BODY:\n${body}`,
  });

  // Try to get the text output in a version-agnostic way
  const rawText =
    (completion as any).output_text ||
    (completion as any).output?.[0]?.content?.[0]?.text ||
    "";

  let parsed: ParseTrainEmailOutput;

  try {
    parsed = JSON.parse(rawText) as ParseTrainEmailOutput;
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

  // 2) Hard gate → ALL fields required for dashboard card
  const hasAllRequired =
    requiredString(parsed.provider) &&
    requiredString(parsed.booking_ref) &&
    requiredString(parsed.origin) &&
    requiredString(parsed.destination) &&
    requiredString(parsed.depart_planned) &&
    requiredString(parsed.outbound_departure);

  if (!hasAllRequired) {
    return {
      is_ticket: false,
      ignore_reason: "missing_required_fields_for_dashboard",
    };
  }

  // 3) Valid usable ticket → return strong typed result
  return {
    is_ticket: true,
    provider: parsed.provider!,
    booking_ref: parsed.booking_ref!,
    origin: parsed.origin!,
    destination: parsed.destination!,
    depart_planned: parsed.depart_planned!,
    arrive_planned: parsed.arrive_planned || null,
    outbound_departure: parsed.outbound_departure!,
  };
}
