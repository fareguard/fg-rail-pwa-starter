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
  "delay-repay",
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
// Special-case parser for GWR booking confirmations (noreply@gwr.com)
// The LLM keeps being over-cautious here, so we just regex it.
// ---------------------------------------------------------------------------
type GwrParsed = {
  booking_ref: string | null;
  origin: string;
  destination: string;
  depart_planned: string | null;
  arrive_planned: string | null;
  operator: string;
};

function tryParseGwrTicket(
  subject: string,
  body: string
): GwrParsed | null {
  const lowerBody = body.toLowerCase();

  if (!/outward journey:/i.test(body) || !/departs/i.test(body)) {
    return null;
  }

  // Booking ref from subject or body
  const refMatch =
    subject.match(/booking confirmation\s+([A-Z0-9]{6,10})/i) ||
    body.match(/reference[^A-Z0-9]*([A-Z0-9]{6,10})/i);

  const booking_ref = refMatch ? refMatch[1] : null;

  // Example pattern:
  // "Outward journey: 28 Dec 2025
  //  departs Swansea at 23:27 ... to station Neath arrives 23:39"
  const journeyMatch = body.match(
    /Outward journey:\s*([0-9]{1,2}\s+\w+\s+[0-9]{4})[\s\S]*?departs\s+([A-Za-z][A-Za-z ]+?)\s+at\s+(\d{1,2}:\d{2})[\s\S]*?\bto station\s+([A-Za-z][A-Za-z ]+?)\s+arrives\s+(\d{1,2}:\d{2})/i
  );

  if (!journeyMatch) {
    return null;
  }

  const journeyDate = journeyMatch[1].trim();       // "28 Dec 2025"
  const origin = journeyMatch[2].trim();            // "Swansea"
  const depTime = journeyMatch[3].trim();           // "23:27"
  const destination = journeyMatch[4].trim();       // "Neath"
  const arrTime = journeyMatch[5].trim();           // "23:39"

  const depart_planned = `${journeyDate} ${depTime}`;
  const arrive_planned = `${journeyDate} ${arrTime}`;

  // If the body mentions Transport for Wales, use that as operator.
  const operator = /transport for wales/i.test(lowerBody)
    ? "Transport for Wales"
    : "GWR";

  return {
    booking_ref,
    origin,
    destination,
    depart_planned,
    arrive_planned,
    operator,
  };
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

  const fromLc = from.toLowerCase();

  // 0.5) GWR booking confirmations – parse via regex and skip the LLM
  if (fromLc.includes("@gwr.com")) {
    const gwr = tryParseGwrTicket(subject, body);
    if (gwr) {
      return {
        is_ticket: true,
        provider: "GWR",
        retailer: "GWR",
        operator: gwr.operator,
        booking_ref: gwr.booking_ref || "UNKNOWN",
        origin: gwr.origin,
        destination: gwr.destination,
        // These are "raw" strings; safeTimestamp in route.ts will normalise them.
        depart_planned: gwr.depart_planned,
        arrive_planned: gwr.arrive_planned,
        outbound_departure: gwr.depart_planned,
      };
    }
    // fall through to LLM as a last resort
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
  } catch {
    // If the model somehow didn't give valid JSON, fail safely
    return {
      is_ticket: false,
      ignore_reason: "model_json_parse_error",
    };
  }

  // 2) Model says not a ticket → respect that
  if (!parsed.is_ticket) {
    return {
      is_ticket: false,
      ignore_reason: parsed.ignore_reason || "model_says_not_a_ticket",
    };
  }

  // Helper — require non-empty strings
  const requiredString = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;

  // Clean basic strings
  const origin = parsed.origin?.trim() || "";
  const destination = parsed.destination?.trim() || "";

  const departClean =
    parsed.depart_planned?.trim() || parsed.outbound_departure?.trim() || "";
  const outboundClean =
    parsed.outbound_departure?.trim() || parsed.depart_planned?.trim() || "";
  const arriveClean = parsed.arrive_planned?.trim() || "";

  const retailerClean = parsed.retailer?.trim() || null;
  const operatorClean = parsed.operator?.trim() || null;

  // Normalise provider-ish string for gating
  const providerLike =
    (operatorClean && operatorClean) ||
    (parsed.provider && parsed.provider.trim()) ||
    (retailerClean && retailerClean) ||
    null;

  // 3) Basic trip requirement: provider-ish + origin + destination
  const hasBasicTrip =
    requiredString(providerLike) &&
    requiredString(origin) &&
    requiredString(destination);

  if (!hasBasicTrip) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  // 3.5) Extra safety: if we have NO departure time AT ALL, treat it as non-ticket.
  // This kills TrainPal delay/update e-mails that mention a route but no time.
  if (!departClean && !outboundClean) {
    return {
      is_ticket: false,
      ignore_reason: "missing_departure_time",
    };
  }

  // 4) Valid usable ticket → return strong typed result
  const provider =
    operatorClean ||
    (parsed.provider && parsed.provider.trim()) ||
    retailerClean ||
    "UNKNOWN";

  const booking_ref =
    (parsed.booking_ref && parsed.booking_ref.trim()) || "UNKNOWN";

  return {
    is_ticket: true,
    provider,
    retailer: retailerClean,
    operator: operatorClean,
    booking_ref,
    origin,
    destination,
    depart_planned: departClean || null,
    arrive_planned: arriveClean || null,
    outbound_departure: outboundClean || null,
  };
}
