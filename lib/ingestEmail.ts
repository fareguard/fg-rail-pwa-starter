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
      "- provider: brand that sent/sold the ticket (TrainPal, Trainline, GWR, Avanti, Northern, ScotRail, SWR, etc.).\n" +
      "- retailer: intermediary that sold the ticket if different to the train operator (e.g. TrainPal, Trainline).\n" +
      "- operator: train operating company actually running the service (Avanti West Coast, West Midlands Railway, Northern, ScotRail, Transport for Wales, etc.).\n\n" +
      "TICKET vs NON-TICKET RULES:\n" +
      "- Set is_ticket = true only if this email clearly represents a BOOKED UK rail journey\n" +
      "  (booking confirmation, e-ticket with journey details, etc.).\n" +
      "- Emails that are ONLY about delay compensation, Delay Repay, refunds already processed,\n" +
      "  or generic marketing must be is_ticket = false with a clear ignore_reason\n" +
      "  such as \"delay_compensation_email\" or \"marketing_email\".\n" +
      "- If the email clearly contains a booking reference AND an origin → destination journey\n" +
      "  with a travel date and a departure time, treat it as a ticket – even if it also mentions\n" +
      "  Delay Repay, compensation, or other boilerplate.\n" +
      "- Registration / account-creation emails with no booked journey must be is_ticket = false.\n\n" +
      "FIELD RULES:\n" +
      "- booking_ref: any obvious booking / reference code (e.g. \"FR4KCNC4\", \"343NBKJ9\").\n" +
      "- origin / destination: station names (e.g. \"Dawlish\", \"Starcross\", \"Leeds\", \"Horsforth\").\n" +
      "- depart_planned: planned departure date + time in any consistently parseable form\n" +
      "  (e.g. \"19 Jan 2026 20:13\"). Use the outward/first journey.\n" +
      "- arrive_planned: arrival date/time if clearly available, else null/omit.\n" +
      "- outbound_departure: usually the same as depart_planned; include if you can.\n\n" +
      "If you are unsure whether the email is a ticket, prefer is_ticket = false with a helpful ignore_reason.\n\n" +
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

  // 2) Model says it's not a ticket → honour that, with a sensible reason
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

  // 3) Gating: only accept tickets that have enough info to show on dashboard
  //    We REQUIRE: providerLike + origin + destination + a departure time.
  const hasBasicTrip =
    requiredString(providerLike) &&
    requiredString(parsed.origin) &&
    requiredString(parsed.destination) &&
    requiredString(parsed.depart_planned || parsed.outbound_departure);

  if (!hasBasicTrip) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  // 4) Valid usable ticket → normalise and return strongly typed result

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

  const depart_plannedRaw =
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    (parsed.outbound_departure && parsed.outbound_departure.trim()) ||
    "";

  const outbound_departureRaw =
    (parsed.outbound_departure && parsed.outbound_departure.trim()) ||
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    "";

  const arrive_plannedRaw =
    (parsed.arrive_planned && parsed.arrive_planned.trim()) || "";

  return {
    is_ticket: true,
    provider,
    retailer,
    operator,
    booking_ref,
    origin,
    destination,
    depart_planned: depart_plannedRaw || null,
    arrive_planned: arrive_plannedRaw || null,
    outbound_departure: outbound_departureRaw || null,
  };
}
