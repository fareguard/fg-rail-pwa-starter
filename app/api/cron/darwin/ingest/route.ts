import { NextResponse } from "next/server";
import { Kafka, IHeaders } from "kafkajs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// ===== SECURITY GATE =====
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(request: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = request.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

function json(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env var: ${name}`);
  return String(v).trim();
}

function headerValueToString(v: any): string {
  if (v == null) return "";
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(headerValueToString).join(",");
  // KafkaJS types can be weird; last resort:
  try {
    return String(v);
  } catch {
    return "";
  }
}

function headersToJson(h?: IHeaders) {
  if (!h) return null;
  const out: Record<string, string> = {};
  for (const k of Object.keys(h)) {
    out[k] = headerValueToString((h as any)[k]);
  }
  return out;
}

// ===== CONFIG (env vars) =====
// DARWIN_KAFKA_BOOTSTRAP=pkc-....confluent.cloud:9092
// DARWIN_KAFKA_USERNAME=xxxxx
// DARWIN_KAFKA_PASSWORD=xxxxx
// DARWIN_KAFKA_TOPIC=prod-....
// DARWIN_KAFKA_GROUP_ID=fareguard-....
// Optional:
// DARWIN_INGEST_MAX_MESSAGES=50
// DARWIN_INGEST_MAX_MS=15000
export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) return json({ ok: false }, 404);

    const bootstrap = mustEnv("DARWIN_KAFKA_BOOTSTRAP");
    const username = mustEnv("DARWIN_KAFKA_USERNAME");
    const password = mustEnv("DARWIN_KAFKA_PASSWORD");
    const topic = mustEnv("DARWIN_KAFKA_TOPIC");
    const groupId = mustEnv("DARWIN_KAFKA_GROUP_ID");

    const MAX_MESSAGES = Number(process.env.DARWIN_INGEST_MAX_MESSAGES ?? "50");
    const MAX_MS = Number(process.env.DARWIN_INGEST_MAX_MS ?? "15000");

    const db = getSupabaseAdmin();

    const kafka = new Kafka({
      clientId: "fareguard-darwin-ingest",
      brokers: [bootstrap],
      ssl: true,
      sasl: { mechanism: "plain", username, password },
      connectionTimeout: 15000,
      authenticationTimeout: 15000,
      requestTimeout: 30000,
    });

    const consumer = kafka.consumer({ groupId });

    let received = 0;
    let inserted = 0;

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    const startedAt = Date.now();

    const runPromise = consumer.run({
      autoCommit: true,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale()) return;

        for (const message of batch.messages) {
          if (!isRunning() || isStale()) break;

          received++;

          const valueStr = message.value ? message.value.toString("utf8") : "";
          let payload: any;
          try {
            payload = JSON.parse(valueStr);
          } catch {
            payload = { raw: valueStr };
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
            .upsert([row], {
              onConflict: "topic,partition,kafka_offset",
              ignoreDuplicates: true,
            });

          if (error) throw new Error(`Supabase upsert failed: ${error.message}`);

          inserted++;

          resolveOffset(message.offset);
          await heartbeat();

          if (received >= MAX_MESSAGES) break;
          if (Date.now() - startedAt > MAX_MS) break;
        }

        if (received >= MAX_MESSAGES || Date.now() - startedAt > MAX_MS) {
          await consumer.stop();
        }
      },
    });

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(async () => {
        try {
          await consumer.stop();
        } catch {}
        resolve();
      }, MAX_MS)
    );

    await Promise.race([runPromise, timeoutPromise]);

    await consumer.disconnect();

    return json({
      ok: true,
      topic,
      groupId,
      received,
      inserted,
      max: { messages: MAX_MESSAGES, ms: MAX_MS },
    });
  } catch (e: any) {
    console.error("[darwin ingest] error", e?.stack || e?.message || e);
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
