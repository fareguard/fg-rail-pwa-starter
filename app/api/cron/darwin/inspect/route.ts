import { NextResponse } from "next/server";
import { Kafka } from "kafkajs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Security gate (same style as your other cron routes)
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

function clean(s: string) {
  // IMPORTANT: strips hidden newlines/spaces that break topic matching
  return String(s || "").trim();
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ ok: false }, { status: 404 });

    const bootstrap = clean(must("DARWIN_KAFKA_BOOTSTRAP"));
    const username = must("DARWIN_KAFKA_USERNAME");
    const password = must("DARWIN_KAFKA_PASSWORD");
    const topic = clean(must("DARWIN_KAFKA_TOPIC"));

    const kafka = new Kafka({
      clientId: "fareguard-darwin-inspect",
      brokers: [bootstrap],
      ssl: true,
      sasl: { mechanism: "plain", username, password },
    });

    const admin = kafka.admin();
    await admin.connect();

    const topics = await admin.listTopics();
    const exists = topics.includes(topic);

    let offsets: any = null;
    if (exists) {
      // Returns low/high per partition (if topic has data, high will be > 0)
      offsets = await admin.fetchTopicOffsets(topic);
    }

    await admin.disconnect();

    return NextResponse.json({
      ok: true,
      topic,
      exists,
      topics_count: topics.length,
      offsets, // if exists=false, this stays null
      hint:
        exists
          ? "If offsets.high is > 0 on any partition, the topic has data. If all highs are 0, there's nothing to consume yet."
          : "Topic string does not match any topic Confluent sees (usually whitespace/newline or wrong topic).",
    });
  } catch (e: any) {
    console.error("[darwin inspect] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
