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
// Helpers
// ---------------------------------------------------------------------------

// Strip code fences / extra junk and extract the JSON object
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

// Obvious delay-repay *claims* / compensation emails (not just CTAs)
const DELAY_EMAIL_HARD_KEYWORDS = [
  "your delay repay claim",
  "your claim reference",
  "your claim has been approved",
  "your claim has been processed",
  "we have processed your claim",
  "we have sent your compensation",
  "delay compensation for your journey",
];

function looksLikeDelayClaim(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return DELAY_EMAIL_HARD_KEYWORDS.some((k) => text.includes(k));
}

// E-ticket *delivery* emails (we usually want the booking confirmation instead)
function looksLikeEticketDelivery(subject: string, body: string): boolean {
  const s = subject.toLowerCase();
  const b = body.toLowerCase();

  const mentionsEticket =
    s.includes("eticket") ||
    s.includes("e-ticket") ||
    s.includes("etickets") ||
    s.includes("e-tickets");

  const mentionsAttached =
    b.includes("we've attached etickets") ||
    b.includes("we have attached etickets") ||
    b.includes("etickets for your trip") ||
    b.includes("e-tickets for your trip");

  // Trainline / TOCs often send:
  //  1) “Your trip is confirmed… This is just a booking confirmation.”  ✅ keep
  //  2) “We’ve attached your e-tickets…”                                 ❌ drop
  const isBookingConfirmation =
    b.includes("this is just a booking confirmation");

  return mentionsEticket && mentionsAttached && !isBookingConfirmation;
}

// Quick regex: does the text contain any time-like “HH:MM”
function hasTimeLike(text: string): boolean {
  return /\b([0-2]?\d:[0-5]\d)\b/.test(text);
}

function requiredString(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Regex fallback parser – operator-agnostic
//  Used when the LLM says “not a ticket” or misses fields.
//  Designed to catch:
//   - GWR, SWR, ScotRail style “Journey: 1 X to Y … Outward journey…”
//   - Generic TOC booking confirmations
// ---------------------------------------------------------------------------

function fallbackParseJourney(
  from: string,
  subject: string,
  body: string
): ParseTrainEmailOutput | null {
  const fromLower = from.toLowerCase();
  const text = `${subject}\n${body}`;

  // 1) Try to pull out “Journey: 1 Dawlish to Starcross …”
  const journeyMatch = text.match(
    /Journey:\s*\d+\s+([A-Za-z &'()\/-]+?)\s+to\s+([A-Za-z &'()\/-]+?)(?:\s|@|\r?\n)/i
  );

  if (!journeyMatch) {
    return null;
  }

  const origin = journeyMatch[1].trim();
  const destination = journeyMatch[2].trim();

  // 2) Try booking reference
  const refMatch =
    text.match(/Your booking reference[: ]+([A-Z0-9]{5,12})/i) ||
    text.match(/reference number is\s*([A-Z0-9]{5,12})/i) ||
    text.match(/\bRef[: ]+([A-Z0-9]{5,12})\b/i);

  // 3) Try date + time
  const dateMatch =
    text.match(/Outward journey:\s*([0-9]{1,2}\s+\w+\s+20[0-9]{2})/i) ||
    text.match(
      /Outward\s+[A-Za-z]+\s+([0-9]{1,2}\s+\w+\s+20[0-9]{2})/i
    ) ||
    text.match(/\b([0-9]{1,2}\/[0-9]{1,2}\/20[0-9]{2})\b/);

  const timeMatch =
    text.match(/departs\s+[A-Za-z &'()\/-]+?\s+at\s+([0-9]{1,2}:[0-9]{2})/i) ||
    text.match(/\b([0-2]?\d:[0-5]\d)\b/);

  let depart_planned: string | undefined;
  if (dateMatch && timeMatch) {
    depart_planned = `${dateMatch[1]} ${timeMatch[1]}`;
  } else if (dateMatch) {
    depart_planned = dateMatch[1];
  } else if (timeMatch) {
    depart_planned = timeMatch[1];
  }

  // 4) Guess provider / retailer / operator from the from: address
  let provider: string | undefined;
  let retailer: string | undefined;
  let operator: string | undefined;

  if (fromLower.includes("trainline")) {
    provider = "Trainline";
    retailer = "Trainline";
  } else if (fromLower.includes("trainpal")) {
    provider = "TrainPal";
    retailer = "TrainPal";
  } else if (fromLower.includes("@gwr.com")) {
    provider = "GWR";
    operator = "GWR";
  } else if (fromLower.includes("southwesternrailway")) {
    provider = "South Western Railway";
    operator = "South Western Railway";
  } else if (fromLower.includes("scotrail")) {
    provider = "ScotRail";
    operator = "ScotRail";
  }

  return {
    is_ticket: true,
    ignore_reason: undefined,
    provider,
    retailer,
    operator,
    booking_ref: refMatch?.[1],
    origin,
    destination,
    depart_planned,
    arrive_planned: undefined,
    outbound_departure: depart_planned,
  };
}

// ---------------------------------------------------------------------------
// MAIN
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

  // 0) HARD BLOCK: genuine Delay Repay *claim* emails
  if (looksLikeDelayClaim(subject, body)) {
    return {
      is_ticket: false,
      ignore_reason: "delay_compensation_email",
    };
  }

  // 0.5) Drop pure e-ticket delivery emails to avoid duplicates
  if (looksLikeEticketDelivery(subject, body)) {
    return {
      is_ticket: false,
      ignore_reason: "eticket_delivery_email",
    };
  }

  // 1) LLM pass – ask for STRICT JSON
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
      "- provider: brand that sold the ticket (TrainPal, Trainline, GWR, Avanti, Northern, ScotRail, etc.).\n" +
      "- retailer: intermediary like TrainPal/Trainline when the actual operator is another TOC.\n" +
      "- operator: the train operating company running the service (Avanti West Coast, West Midlands Railway, CrossCountry, Northern, Transport for Wales, etc.).\n\n" +
      "RULES:\n" +
      "- Only set is_ticket = true if this email clearly represents a BOOKED UK rail journey or e-ticket / booking confirmation.\n" +
      "- Booking confirmations like \"Your GWR booking confirmation 9HFGG44C\" or\n" +
      "  \"Confirmation of your South Western Railway booking\" MUST be treated as tickets\n" +
      "  if they describe a journey such as \"Journey: 1 Dawlish to Starcross\" or\n" +
      "  \"Journey: 1 Sunbury to Upper Halliford\" and an outward journey / departure time.\n" +
      "- If an aggregator (TrainPal / Trainline) sells a journey on another operator:\n" +
      "    * retailer = \"TrainPal\" or \"Trainline\" (etc.)\n" +
      "    * operator = e.g. \"West Midlands Railway\", \"Avanti West Coast\", \"CrossCountry\", \"Northern\", etc.\n" +
      "    * provider can be either the retailer or the operator.\n" +
      "- If the email is primarily about Delay Repay or compensation for a journey that already happened,\n" +
      "  set is_ticket = false and explain in ignore_reason.\n" +
      "- If you are unsure, prefer is_ticket = false with a clear ignore_reason.\n\n" +
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

  // -----------------------------------------------------------------------
  // 2) LLM says “not a ticket” or misses fields → try regex fallback
  // -----------------------------------------------------------------------

  // Derive a provider-like thing for gating
  const providerLike =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    null;

  const hasBasicTripLLM =
    parsed.is_ticket &&
    requiredString(providerLike) &&
    requiredString(parsed.origin) &&
    requiredString(parsed.destination);

  if (!hasBasicTripLLM) {
    const fb = fallbackParseJourney(from, subject, body);
    if (!fb) {
      return {
        is_ticket: false,
        ignore_reason:
          parsed.ignore_reason ||
          "missing_basic_fields_for_dashboard",
      };
    }
    parsed = fb;
  }

  // At this point, parsed should describe a usable ticket

  // -----------------------------------------------------------------------
  // 3) Extra safety: drop weird aggregator emails with no time at all
  //    (e.g. TrainPal summary emails that caused “Departs —” and dupes)
  // -----------------------------------------------------------------------
  const fullText = `${subject}\n${body}`;
  const hasAnyTime =
    hasTimeLike(parsed.depart_planned || "") ||
    hasTimeLike(parsed.outbound_departure || "") ||
    hasTimeLike(fullText);

  const lowerProvider =
    (parsed.provider || parsed.retailer || "").toLowerCase();

  const isBareAggregator =
    !parsed.operator &&
    (lowerProvider.includes("trainpal") ||
      lowerProvider.includes("trainline"));

  if (isBareAggregator && !hasAnyTime) {
    return {
      is_ticket: false,
      ignore_reason: "aggregator_email_without_time",
    };
  }

  // -----------------------------------------------------------------------
  // 4) Normalise + return strong typed ParsedTicketResult
  // -----------------------------------------------------------------------

  const provider =
    (parsed.operator && parsed.operator.trim()) ||
    (parsed.provider && parsed.provider.trim()) ||
    (parsed.retailer && parsed.retailer.trim()) ||
    "UNKNOWN";

  const retailer =
    (parsed.retailer && parsed.retailer.trim()) || null;

  const operator =
    (parsed.operator && parsed.operator.trim()) || null;

  const origin = (parsed.origin || "").trim();
  const destination = (parsed.destination || "").trim();

  const booking_ref =
    (parsed.booking_ref && parsed.booking_ref.trim()) ||
    "UNKNOWN";

  const depart_planned_raw =
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    (parsed.outbound_departure &&
      parsed.outbound_departure.trim()) ||
    "";

  const outbound_departure_raw =
    (parsed.outbound_departure &&
      parsed.outbound_departure.trim()) ||
    (parsed.depart_planned && parsed.depart_planned.trim()) ||
    "";

  const arrive_planned_raw =
    (parsed.arrive_planned && parsed.arrive_planned.trim()) ||
    "";

  return {
    is_ticket: true,
    ignore_reason: undefined,
    provider,
    retailer,
    operator,
    booking_ref,
    origin,
    destination,
    depart_planned:
      depart_planned_raw.length > 0 ? depart_planned_raw : null,
    arrive_planned:
      arrive_planned_raw.length > 0 ? arrive_planned_raw : null,
    outbound_departure:
      outbound_departure_raw.length > 0
        ? outbound_departure_raw
        : null,
  };
}
