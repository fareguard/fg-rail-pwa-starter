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
    const maxMs = Math.min(Number(url.searchParams.get("ms") || "60000"), 120000);

    const bootstrap = clean(must("DARWIN_KAFKA_BOOTSTRAP"));
    const username = must("DARWIN_KAFKA_USERNAME");
    const password = must("DARWIN_KAFKA_PASSWORD");
    const topic = clean(must("DARWIN_KAFKA_TOPIC"));
    const baseGroupId = clean(must("DARWIN_KAFKA_GROUP_ID"));
    const groupId = groupOverride || baseGroupId;

    const kafka = new Kafka({
      clientId: "fareguard-darwin-ingest",
      brokers: [bootstrap],
      ssl: true,
      sasl: { mechanism: "plain", username, password },
      logLevel: logLevel.NOTHING,
    });

    const db = getSupabaseAdmin();

    // ---- debug: admin offsets (proves topic exists + has data) ----
    const admin = kafka.admin();
    await admin.connect();
    const offsets = await admin.fetchTopicOffsets(topic);
    await admin.disconnect();

    // ---- consume burst ----
    const consumer = kafka.consumer({
      groupId,
      // helps serverless environments
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      retry: { retries: 3 },
    });

    let joined = false;
    let assigned: any[] = [];
    let received = 0;
    let inserted = 0;
    let batchesSeen = 0;
    const errors: any[] = [];

    // kafkajs event name string (safe)
    consumer.on((consumer as any).events.GROUP_JOIN, (e: any) => {
      joined = true;
      assigned = e?.payload?.memberAssignment
        ? Object.entries(e.payload.memberAssignment).map(([t, parts]: any) => ({
            topic: t,
            partitions: parts,
          }))
        : [];
    });

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: from === "earliest" });

    const start = Date.now();

    const runPromise = consumer.run({
      // eachBatch gives us more certainty than eachMessage
      eachBatchAutoResolve: true,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale()) return;
        batchesSeen++;

        for (const message of batch.messages) {
          received++;
          if (received > maxMessages) break;

          try {
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

            if (!error) inserted++;
            else errors.push({ where: "db", message: error.message });
          } catch (e: any) {
            errors.push({ where: "eachBatch", message: e?.message || String(e) });
          }

          resolveOffset(message.offset);
          await heartbeat();
        }
      },
    });

    while (Date.now() - start < maxMs && received < maxMessages) {
      await new Promise((r) => setTimeout(r, 250));
    }

    await consumer.disconnect().catch(() => {});
    await runPromise.catch(() => {});

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
      hint:
        !joined
          ? "Not joining the consumer group before exit. Try longer ms or check network restrictions."
          : assigned?.length === 0
          ? "Joined but no partitions assigned (rare)."
          : inserted === 0
          ? "Assigned partitions but still inserted=0; likely no fetch before exit or auth/ACL issue (check errors)."
          : "Ingest working.",
      errors: errors.slice(0, 5),
    });
  } catch (e: any) {
    console.error("[darwin ingest] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
