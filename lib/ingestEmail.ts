// lib/ingestEmail.ts

import openai from "@/lib/openai";
import type { ParsedTicketResult, ParseTrainEmailOutput } from "./trainEmailFilter";

export type IngestEmailArgs = {
  id?: string;          // <-- added so route.ts stops erroring
  subject: string;
  from: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
};

export async function ingestEmail({
  id,
  subject,
  from,
  bodyHtml,
  bodyText,
}: IngestEmailArgs): Promise<ParsedTicketResult> {

  const body = bodyText || bodyHtml || "";

  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a strict train ticket email parser for a UK train-delay-refund app. " +
          "Only mark is_ticket=true if this email clearly contains a UK train e-ticket or journey confirmation " +
          "(Trainline, National Rail, Avanti, WMR, Northern, etc.). " +
          "If it's marketing, receipts, general account stuff, or unclear, return is_ticket=false with a clear ignore_reason.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Email-ID: ${id || "unknown"}\nFrom: ${from}\nSubject: ${subject}\n\n${body}`,
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "parse_train_email_output",
        schema: {
          type: "object",
          properties: {
            is_ticket: { type: "boolean" },
            ignore_reason: { type: "string" },
            provider: { type: "string" },
            booking_ref: { type: "string" },
            origin: { type: "string" },
            destination: { type: "string" },
            depart_planned: { type: "string" },
            arrive_planned: { type: "string" },
            outbound_departure: { type: "string" },
          },
          required: ["is_ticket"],
          additionalProperties: true,
        },
        strict: true,
      },
    },
  });

  const parsed =
    (completion.output[0].content[0] as any).parsed as ParseTrainEmailOutput;

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

  // 2) Hard gate → ALL fields required for dashboard
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
