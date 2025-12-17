import { NextResponse } from "next/server";
import { Kafka } from "kafkajs";
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

function headersToJson(h?: Record<string, Buffer>) {
  if (!h) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    try {
      out[k] = v?.toString("utf8") ?? "";
    } catch {
      out[k] = "";
    }
  }
  return out;
}

// ===== CONFIG (env vars) =====
// Recommended names (use what you already set, but these are the ones this file expects):
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
      sasl: {
        mechanism: "plain",
        username,
        password,
      },
      connectionTimeout: 15000,
      authenticationTimeout: 15000,
      requestTimeout: 30000,
    });

    const consumer = kafka.consumer({ groupId });

    let received = 0;
    let inserted = 0;
    let dupes = 0;

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    const startedAt = Date.now();

    // We wrap run() so we can stop after a short time/batch (serverless-safe)
    const runPromise = consumer.run({
      autoCommit: true,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale()) return;

        for (const message of batch.messages) {
          if (!isRunning() || isStale()) break;

          received++;

          const row = {
            topic: batch.topic,
            partition: batch.partition,
            kafka_offset: Number(message.offset),
            message_key: message.key ? message.key.toString("utf8") : null,
            payload: (() => {
              const s = message.value ? message.value.toString("utf8") : "";
              // Darwin push port payload is JSON; but be defensive
              try {
                return JSON.parse(s);
              } catch {
                return { raw: s };
              }
            })(),
            headers: headersToJson(message.headers),
          };

          const { error } = await db
            .from("darwin_messages")
            .upsert([row], {
              onConflict: "topic,partition,kafka_offset",
              ignoreDuplicates: true,
            });

          if (error) {
            // If this fails, stop fast and surface the DB error
            throw new Error(`Supabase upsert failed: ${error.message}`);
          }

          // If ignoreDuplicates is true we can’t directly know insert vs dupe
          // so we’ll approximate: count as inserted
          inserted++;

          resolveOffset(message.offset);
          await heartbeat();

          if (received >= MAX_MESSAGES) break;
          if (Date.now() - startedAt > MAX_MS) break;
        }

        // Stop conditions
        if (received >= MAX_MESSAGES || Date.now() - startedAt > MAX_MS) {
          // mark the batch as processed
          // resolve the last offset if any (already done per-message above)
          await consumer.stop();
        }
      },
    });

    // Safety stop: even if no messages arrive, stop after MAX_MS
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
      dupes, // kept for future (we’re not reliably counting dupes yet)
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
