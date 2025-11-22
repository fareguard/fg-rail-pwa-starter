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

// Normalise branding so UI pills look tidy & dedupe obvious variants
function normaliseBrandName(raw: string | null | undefined): string {
  const t = (raw || "").trim();
  if (!t) return "";

  const lower = t.toLowerCase();

  if (lower.includes("trainpal")) return "TrainPal";
  if (lower.includes("trainline")) return "Trainline";

  if (lower.includes("crosscountry")) return "CrossCountry";

  if (lower.includes("avanti")) return "Avanti West Coast";

  if (lower.includes("west midlands railway") || lower.includes("wmr"))
    return "West Midlands Railway";

  if (lower.includes("west midlands trains"))
    return "West Midlands Railway";

  if (lower.includes("chiltern")) return "Chiltern Railways";

  if (lower.includes("northern")) return "Northern";

  if (lower.includes("great western") || lower === "gwr")
    return "Great Western Railway";

  if (lower.includes("transport for wales") || lower === "tfw")
    return "Transport for Wales";

  return t;
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

  const prompt = `
You are a strict train ticket email parser for a UK train-delay-refund app.

Return ONLY a JSON object, no explanation, no markdown.

Shape:
{
  "is_ticket": boolean,
  "ignore_reason"?: string,

  "provider"?: string,   // generic name – OK if same as retailer or operator
  "retailer"?: string,   // seller / app (Trainline, TrainPal, GWR, etc.)
  "operator"?: string,   // train operating company (Avanti, WMR, Northern, etc.)

  "booking_ref"?: string,

  "origin"?: string,     // station name
  "destination"?: string,

  "depart_planned"?: string,        // first planned departure time
  "arrive_planned"?: string,        // planned arrival time (optional)
  "outbound_departure"?: string     // duplicate of depart_planned is OK
}

Rules:

- Mark "is_ticket" = true ONLY for actual UK rail e-ticket / booking confirmations.
  Do NOT mark true for:
  - Delay/cancellation notifications ("your train was delayed", "compensation")
  - Marketing emails
  - Generic account emails
  - Seating updates where the ticket itself is not attached.

- If the email is clearly a delay/cancellation/compensation notice with no attached e-ticket,
  set "is_ticket" = false and give a clear "ignore_reason".

- For aggregators:
  - TrainPal / Trainline / GWR app, etc:
    - "retailer" = the app/website (e.g. "TrainPal").
    - "operator" = the train company actually running the service
      (e.g. "West Midlands Railway", "Avanti West Coast", "Northern").
  - For direct TOC tickets (booked directly with Avanti, CrossCountry, Northern, etc):
    - "retailer" and "operator" can be the same brand name.

- Example:
  Subject: "TrainPal: Booking Confirmation: Birmingham New Street ↔ London Euston"
  Body mentions West Midlands Railway.
  Then:
    "retailer": "TrainPal"
    "operator": "West Midlands Railway"
    "origin": "Birmingham New Street"
    "destination": "London Euston"

- Times:
  - If you can see a clear departure time, put it in "depart_planned" and/or "outbound_departure".
  - ISO 8601 is ideal (e.g. "2025-11-10T05:37:00"), but a normal UK datetime string is OK:
    "10 Nov 2025 05:37".
  - If you truly cannot find a departure time, you may leave these fields empty,
    but in that case strongly prefer "is_ticket" = false (likely a delay/marketing email).

- booking_ref:
  - Use the booking reference if present (e.g. "FR4KCNC4").
  - If you can't confidently find one, you may leave it empty.

If it's marketing, receipts, general account stuff, or unclear, set "is_ticket" = false
and give a clear "ignore_reason".

EMAIL METADATA:
Email-ID: ${id || "unknown"}
From: ${from}
Subject: ${subject}

EMAIL BODY:
${body}
`.trim();

  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
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

  // 2) Must at least have origin + destination
  if (
    !requiredString(parsed.origin) ||
    !requiredString(parsed.destination)
  ) {
    return {
      is_ticket: false,
      ignore_reason: "missing_basic_fields_for_dashboard",
    };
  }

  // 3) Require at least one departure time.
  // This kills delay / generic notification emails where we can't find a clear time.
  const hasAnyTime =
    requiredString(parsed.depart_planned) ||
    requiredString(parsed.outbound_departure);

  if (!hasAnyTime) {
    return {
      is_ticket: false,
      ignore_reason: "no_departure_time_found",
    };
  }

  // 4) Build clean strings
  const providerRaw =
    parsed.provider || parsed.retailer || parsed.operator || "UNKNOWN";

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

  // Brand logic -----------------------------------------------------

  // First take whatever the model gave us
  let retailer = parsed.retailer || "";
  let operator = parsed.operator || "";
  let provider = providerRaw;

  // Heuristics from From:/Subject: if retailer is missing
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();

  if (!retailer) {
    if (fromLower.includes("trainpal") || subjectLower.includes("trainpal")) {
      retailer = "TrainPal";
    } else if (
      fromLower.includes("trainline") ||
      subjectLower.includes("trainline")
    ) {
      retailer = "Trainline";
    } else if (fromLower.includes("gwr") || subjectLower.includes("gwr")) {
      retailer = "GWR";
    } else {
      retailer = provider;
    }
  }

  // If operator is empty, use provider unless this is clearly an aggregator
  if (!operator) {
    const aggLower = retailer.toLowerCase();
    if (
      aggLower.includes("trainpal") ||
      aggLower.includes("trainline") ||
      aggLower === "gwr"
    ) {
      operator = provider;
    } else {
      operator = retailer || provider;
    }
  }

  // Normalise branding so CrossCountry Trains / CrossCountry collapse, etc.
  provider = normaliseBrandName(provider);
  retailer = normaliseBrandName(retailer);
  operator = normaliseBrandName(operator);

  return {
    is_ticket: true,
    provider,
    retailer: retailer || provider,
    operator: operator || provider,
    booking_ref,
    origin,
    destination,
    depart_planned,
    arrive_planned,
    outbound_departure,
  };
}
