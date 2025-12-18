import { NextResponse } from "next/server";
import { Kafka, logLevel } from "kafkajs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";
function isAuthorized(req: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  return (req.headers.get("x-admin-key") || "") === ADMIN_KEY;
}

const clean = (s: any) => String(s || "").trim();
function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function headersToJson(h: any) {
  const out: Record<string, any> = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) {
    if (Buffer.isBuffer(v)) out[k] = v.toString("utf8");
    else if (Array.isArray(v))
      out[k] = v.map((x) => (Buffer.isBuffer(x) ? x.toString("utf8") : String(x)));
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
    const from = clean(url.searchParams.get("from") || "latest").toLowerCase(); // earliest|latest
    const groupOverride = clean(url.searchParams.get("group") || "");
    const maxMessages = Math.min(Number(url.searchParams.get("max") || "200"), 500);
    const maxMs = Math.min(Number(url.searchParams.get("ms") || "90000"), 120000);

    const bootstrap = clean(must("DARWIN_KAFKA_BOOTSTRAP"));
    const username = must("DARWIN_KAFKA_USERNAME");
    const password = must("DARWIN_KAFKA_PASSWORD");
    const topic = clean(must("DARWIN_KAFKA_TOPIC"));
    const baseGroupId = clean(must("DARWIN_KAFKA_GROUP_ID"));
    const groupId = groupOverride || baseGroupId;

    const kafka = new Kafka({
      clientId: `fareguard-darwin-ingest-${Date.now()}`,
      brokers: [bootstrap],
      ssl: true,
      sasl: { mechanism: "plain", username, password },
      logLevel: logLevel.NOTHING,
    });

    // Prove broker reachable + topic exists
    const admin = kafka.admin();
    await admin.connect();
    const offsets = await admin.fetchTopicOffsets(topic);
    await admin.disconnect();

    const db = getSupabaseAdmin();

    const consumer = kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      retry: { retries: 2 },
    });

    let joined = false;
    let assigned: any = null;
    let received = 0;
    let inserted = 0;
    let batchesSeen = 0;

    const errors: any[] = [];
    const events = (consumer as any).events;

    // IMPORTANT: capture crashes (this is what you’re missing)
    consumer.on(events.CRASH, (e: any) => {
      errors.push({
        type: "CRASH",
        message: e?.payload?.error?.message || e?.payload?.error?.name || "consumer crash",
        stack: e?.payload?.error?.stack,
      });
    });

    consumer.on(events.GROUP_JOIN, (e: any) => {
      joined = true;
      assigned = e?.payload?.memberAssignment || null;
    });

    consumer.on(events.REQUEST_TIMEOUT, () => {
      errors.push({ type: "REQUEST_TIMEOUT" });
    });

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: from === "earliest" });

    const start = Date.now();

    // Don’t swallow run errors — capture them
    const runPromise = consumer
      .run({
        eachBatchAutoResolve: true,
        eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
          if (!isRunning() || isStale()) return;

          batchesSeen++;

          for (const message of batch.messages) {
            received++;
            if (received > maxMessages) break;

            const payloadStr = message.value ? message.value.toString("utf8") : "{}";
            let payload: any;
            try {
              payload = JSON.parse(payloadStr);
            } catch {
              payload = { _raw: payloadStr };
            }

            const row = {
              topic: batch.topic,
              partition: batch.partition,
              kafka_offset: Number(message.offset),
              message_key: message.key ? message.key.toString("utf8") : null,
              payload,
              headers: headersToJson(message.headers),
            };

            const { error } = await db
              .from("darwin_messages")
              .upsert(row, { onConflict: "topic,partition,kafka_offset" });

            if (error) {
              errors.push({ type: "DB", message: error.message });
            } else {
              inserted++;
            }

            resolveOffset(message.offset);
            await heartbeat();
          }
        },
      })
      .catch((e: any) => {
        errors.push({ type: "RUN_THROW", message: e?.message || String(e), stack: e?.stack });
      });

    // Wait for either messages, a crash, or timeout
    while (Date.now() - start < maxMs && received < maxMessages) {
      if (errors.length) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    await consumer.disconnect().catch(() => {});
    await runPromise;

    return NextResponse.json({
      ok: true,
      topic,
      groupId,
      from,
      joined,
      assigned,
      offsets,
      batchesSeen,
      received,
      inserted,
      max: { messages: maxMessages, ms: maxMs },
      errors,
      hint:
        errors.length
          ? "See errors[] — that’s the real reason it never joins."
          : !joined
          ? "Still not joining and no crash reported (rare). Try ms=120000 and paste offsets + response."
          : "Joined but no batches yet (possible if fetch not happening before exit).",
    });
  } catch (e: any) {
    console.error("[darwin ingest] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
