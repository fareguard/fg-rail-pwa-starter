import { NextResponse } from "next/server";
import { Kafka, logLevel } from "kafkajs";
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

function splitTopics(raw: string | undefined) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return json({ ok: false }, 404);

  const bootstrap = process.env.DARWIN_KAFKA_BOOTSTRAP || "";
  const username = process.env.DARWIN_KAFKA_USERNAME || "";
  const password = process.env.DARWIN_KAFKA_PASSWORD || "";
  const groupId = process.env.DARWIN_KAFKA_GROUP_ID || "";
  const topics = splitTopics(process.env.DARWIN_KAFKA_TOPICS);

  const maxMessages = Number(process.env.DARWIN_INGEST_MAX_MESSAGES ?? "200");
  const maxSeconds = Number(process.env.DARWIN_INGEST_MAX_SECONDS ?? "8");

  if (!bootstrap || !username || !password || !groupId || topics.length === 0) {
    return json(
      {
        ok: false,
        error: "Missing Darwin Kafka env vars",
        missing: {
          DARWIN_KAFKA_BOOTSTRAP: !bootstrap,
          DARWIN_KAFKA_USERNAME: !username,
          DARWIN_KAFKA_PASSWORD: !password,
          DARWIN_KAFKA_GROUP_ID: !groupId,
          DARWIN_KAFKA_TOPICS: topics.length === 0,
        },
      },
      500
    );
  }

  const db = getSupabaseAdmin();

  const kafka = new Kafka({
    clientId: "fareguard-darwin-ingest",
    brokers: [bootstrap],
    logLevel: logLevel.NOTHING,
    ssl: true,
    sasl: {
      mechanism: "plain",
      username,
      password,
    },
    connectionTimeout: 15000,
    authenticationTimeout: 15000,
  });

  const consumer = kafka.consumer({ groupId });

  const startedAt = Date.now();
  let consumed = 0;
  let inserted = 0;
  let dupes = 0;
  let parseErrors = 0;

  try {
    await consumer.connect();

    for (const t of topics) {
      await consumer.subscribe({ topic: t, fromBeginning: false });
    }

    await consumer.run({
      autoCommit: true,
      eachMessage: async ({ topic, partition, message }) => {
        if (consumed >= maxMessages) return;

        consumed++;

        // payload should be JSON on the JSON topic; guard anyway
        const rawValue = message.value?.toString("utf8") || "";
        let payload: any = null;

        try {
          payload = rawValue ? JSON.parse(rawValue) : null;
        } catch {
          parseErrors++;
          payload = { _raw: rawValue };
        }

        const message_key = message.key ? message.key.toString("utf8") : null;

        const headersObj: Record<string, any> = {};
        if (message.headers) {
          for (const [k, v] of Object.entries(message.headers)) {
            headersObj[k] = v ? v.toString("utf8") : null;
          }
        }

        // Insert idempotently (unique topic+partition+offset)
        const { error } = await db
          .from("darwin_messages")
          .insert({
            topic,
            partition,
            offset: Number(message.offset),
            message_key,
            payload,
            headers: Object.keys(headersObj).length ? headersObj : null,
          });

        if (error) {
          // duplicate key -> count as dupe
          if (String(error.message || "").toLowerCase().includes("duplicate")) {
            dupes++;
          } else {
            // don’t crash the whole run because one insert failed
            console.error("[darwin ingest] insert error", error);
          }
        } else {
          inserted++;
        }
      },
    });

    // Run for N seconds then stop (serverless-safe-ish)
    while (Date.now() - startedAt < maxSeconds * 1000 && consumed < maxMessages) {
      await new Promise((r) => setTimeout(r, 250));
    }

    await consumer.stop();
    await consumer.disconnect();

    return json({
      ok: true,
      topics,
      limits: { maxMessages, maxSeconds },
      stats: { consumed, inserted, dupes, parseErrors },
    });
  } catch (e: any) {
    try {
      await consumer.stop();
      await consumer.disconnect();
    } catch {}
    console.error("[darwin ingest] fatal", e);
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
