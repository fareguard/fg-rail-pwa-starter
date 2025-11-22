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

function cleanStr(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length ? t : null;
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
      "  set provider = the train operating company (e.g. 'West Midlands Railway'),\n" +
      "  origin = 'Birmingham New Street', destination = 'Cannock'.\n" +
      "- booking_ref is OPTIONAL. If you can't confidently find one, leave it empty or null.\n" +
      "- depart_planned / outbound_departure should be an ISO-like datetime if possible; if unsure, leave empty.\n" +
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
  } catch {
    // If the model somehow didn't give valid JSON, fail safely
    return {
      is_ticket: false,
      ignore_reason: "model_json_parse_error",
    };
  }

  // ------------- Heuristics / fallbacks before gating -----------------

  if (parsed.is_ticket) {
    const lowerMeta = `${from} ${subject}`.toLowerCase();

    // If provider missing, infer from metadata
    if (!parsed.provider) {
      if (lowerMeta.includes("crosscountry")) parsed.provider = "CrossCountry";
      else if (lowerMeta.includes("northern")) parsed.provider = "Northern";
      else if (lowerMeta.includes("great western railway") || lowerMeta.includes("gwr"))
        parsed.provider = "Great Western Railway";
      else if (lowerMeta.includes("west midlands railway"))
        parsed.provider = "West Midlands Railway";
      else if (lowerMeta.includes("avanti")) parsed.provider = "Avanti West Coast";
    }

    // If origin/destination missing, try to parse from subject
    // e.g. "TrainPal: Booking Confirmation: Birmingham New Street ↔ Cannock"
    // or   "TrainPal: Booking Confirmation: London Marylebone → Solihull"
    if (!parsed.origin || !parsed.destination) {
      const m =
        subject.match(/Booking Confirmation:\s*(.+?)\s*[↔→-]\s*(.+)$/i) ||
        subject.match(/Booking:\s*(.+?)\s*[↔→-]\s*(.+)$/i);

      if (m) {
        const subjOrigin = cleanStr(m[1]);
        const subjDest = cleanStr(m[2]);
        if (!parsed.origin && subjOrigin) parsed.origin = subjOrigin;
        if (!parsed.destination && subjDest) parsed.destination = subjDest;
      }
    }
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
  const provider = parsed.provider!.trim();
  const origin = parsed.origin!.trim();
  const destination = parsed.destination!.trim();

  const booking_ref = cleanStr(parsed.booking_ref);
  const depart_planned =
    cleanStr(parsed.depart_planned) || cleanStr(parsed.outbound_departure);
  const outbound_departure =
    cleanStr(parsed.outbound_departure) || cleanStr(parsed.depart_planned);
  const arrive_planned = cleanStr(parsed.arrive_planned);

  return {
    is_ticket: true,
    provider,
    booking_ref,
    origin,
    destination,
    depart_planned: depart_planned || null,
    arrive_planned: arrive_planned || null,
    outbound_departure: outbound_departure || null,
  };
}
