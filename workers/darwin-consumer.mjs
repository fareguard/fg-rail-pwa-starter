import { Kafka, logLevel } from "kafkajs";
import { createClient } from "@supabase/supabase-js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// --- required env
const BROKERS_RAW = must("DARWIN_KAFKA_BROKERS");
const topic = must("DARWIN_KAFKA_TOPIC");
const groupId = must("DARWIN_KAFKA_GROUP_ID");
const username = must("DARWIN_KAFKA_USERNAME");
const password = must("DARWIN_KAFKA_PASSWORD");

// IMPORTANT: brokers must be ["host:9092", ...] with no scheme
const brokers = BROKERS_RAW.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((b) => b.replace(/^(sasl_ssl|ssl|plaintext):\/\//i, "")); // strip accidental schemes

const SUPABASE_URL = must("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

const MAX_BATCH = Number(process.env.DARWIN_MAX_MESSAGES_PER_BATCH ?? "500");

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const kafka = new Kafka({
  clientId: `fareguard-darwin-worker`,
  brokers,
  ssl: true, // Confluent Cloud
  sasl: {
    mechanism: "plain",
    username,
    password,
  },
  // Make KafkaJS less “twitchy” on remote cloud brokers
  connectionTimeout: 30000,
  authenticationTimeout: 30000,
  requestTimeout: 60000,
  retry: {
    initialRetryTime: 300,
    maxRetryTime: 5000,
    retries: 20,
  },
  logLevel: logLevel.INFO,
});

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runConsumerOnce({ handleMessage }) {
  const consumer = kafka.consumer({ groupId });

  await consumer.connect();
  console.log("[darwin] connected. topic=", topic, "group=", groupId);

  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    autoCommit: true,
    partitionsConsumedConcurrently: 1,
    eachMessage: async ({ topic, partition, message }) => {
      await handleMessage({ topic, partition, message });
    },
  });
}

// This loop prevents a single coordinator wobble from killing the container
export async function startDarwinWorker({ handleMessage }) {
  while (true) {
    try {
      console.log("[Consumer] Starting");
      await runConsumerOnce({ handleMessage });
      // runConsumerOnce normally never returns unless it errors/stops
    } catch (err) {
      console.error("[Consumer] Crash:", err?.message || err);
      // Backoff then retry
      await sleep(5000);
    }
  }
}

function headersToJson(h) {
  if (!h) return null;
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (Array.isArray(v)) out[k] = v.map(x => (Buffer.isBuffer(x) ? x.toString("utf8") : String(x)));
    else if (Buffer.isBuffer(v)) out[k] = v.toString("utf8");
    else if (v == null) out[k] = null;
    else out[k] = String(v);
  }
  return out;
}

async function insertRow(row) {
  // idempotent insert thanks to your unique index (topic,partition,kafka_offset)
  const { error } = await db.from("darwin_messages").insert(row);
  if (!error) return true;

  // ignore duplicates (already ingested)
  const msg = String(error.message || "");
  if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("darwin_messages_uq")) {
    return false;
  }
  throw error;
}

await startDarwinWorker({
  handleMessage: async ({ topic, partition, message }) => {
    let payload = null;
    try {
      const s = message.value ? message.value.toString("utf8") : "";
      payload = s ? JSON.parse(s) : null;
    } catch {
      payload = { _raw: message.value ? message.value.toString("utf8") : null };
    }

    const row = {
      topic,
      partition,
      kafka_offset: BigInt(message.offset).toString(), // store safely
      message_key: message.key ? message.key.toString("utf8") : null,
      payload,
      headers: headersToJson(message.headers),
    };
