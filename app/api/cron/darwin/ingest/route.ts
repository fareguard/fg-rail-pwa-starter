import { NextResponse } from "next/server";
import { Kafka, logLevel } from "kafkajs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Security gate
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";
function isAuthorized(req: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  return (req.headers.get("x-admin-key") || "") === ADMIN_KEY;
}

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
const clean = (s: string) => String(s || "").trim();

function headersToJson(h: any) {
  // kafkajs headers are Record<string, Buffer | string | (Buffer|string)[] | undefined>
  const out: Record<string, any> = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) {
    if (Buffer.isBuffer(v)) out[k] = v.toString("utf8");
    else if (Array.isArray(v)) out[k] = v.map((x) => (Buffer.isBuffer(x) ? x.toString("utf8") : String(x)));
    else if (typeof v === "string") out[k] = v;
    else if (v == null) out[k] = null;
    else out[k] = String(v);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ ok: false }, { status: 404 });

    const url = new URL(req.url);

    // query params for testing
    const from = (url.searchParams.get("from") || "latest").toLowerCase(); // earliest|latest
    const groupOverride = url.searchParams.get("group");
    const maxMessages = Math.min(Number(url.searchParams.get("max") || "200"), 500);
    const maxMs = Math.min(Number(url.searchParams.get("ms") || "15000"), 60000);

    const bootstrap = clean(must("DARWIN_KAFKA_BOOTSTRAP"));
    const username = must("DARWIN_KAFKA_USERNAME");
    const password = must("DARWIN_KAFKA_PASSWORD");
    const topic = clean(must("DARWIN_KAFKA_TOPIC"));
    const baseGroupId = clean(must("DARWIN_KAFKA_GROUP_ID"));

    const groupId = clean(groupOverride || baseGroupId);

    const kafka = new Kafka({
      clientId: "fareguard-darwin-ingest",
      brokers: [bootstrap],
      ssl: true,
      sasl: { mechanism: "plain", username, password },
      logLevel: logLevel.NOTHING,
    });

    const db = getSupabaseAdmin();

    const consumer = kafka.consumer({ groupId });

    let received = 0;
    let inserted = 0;
    const errors: any[] = [];

    const start = Date.now();

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: from === "earliest" });

    // Run and stop after limits
    const runPromise = consumer.run({
      autoCommit: true,
      eachMessage: async ({ topic, partition, message }) => {
        received++;
        if (received > maxMessages) return;

        try {
          const payloadStr = message.value ? message.value.toString("utf8") : "{}";
          let payload: any;
          try {
            payload = JSON.parse(payloadStr);
          } catch {
            payload = { _raw: payloadStr };
          }

          const row = {
            topic,
            partition,
            kafka_offset: Number(message.offset),
            message_key: message.key ? message.key.toString("utf8") : null,
            payload,
            headers: headersToJson(message.headers),
          };

          const { error } = await db
            .from("darwin_messages")
            .upsert(row, { onConflict: "topic,partition,kafka_offset" });

          if (!error) inserted++;
          else errors.push(error);
        } catch (e: any) {
          errors.push({ message: e?.message || String(e) });
        }

        // stop conditions
        if (received >= maxMessages) {
          // just let it exit naturally after disconnect below
        }
      },
    });

    // wait until time limit
    while (Date.now() - start < maxMs && received < maxMessages) {
      await new Promise((r) => setTimeout(r, 250));
    }

    await consumer.disconnect().catch(() => {});
    await runPromise.catch(() => {}); // ignore after disconnect

    return NextResponse.json({
      ok: true,
      topic,
      groupId,
      from,
      received,
      inserted,
      max: { messages: maxMessages, ms: maxMs },
      note:
        inserted === 0
          ? "If exists=true with high offsets, but inserted=0, use ?from=earliest&group=fresh-group-name to force reads."
          : "Inserted messages into darwin_messages.",
      errors: errors.slice(0, 3),
    });
  } catch (e: any) {
    console.error("[darwin ingest] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
