import { Kafka, logLevel } from "kafkajs";
import { createClient } from "@supabase/supabase-js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const BROKERS_RAW = must("DARWIN_KAFKA_BROKERS");
const topic = must("DARWIN_KAFKA_TOPIC");
const groupId = must("DARWIN_KAFKA_GROUP_ID");
const username = must("DARWIN_KAFKA_USERNAME");
const password = must("DARWIN_KAFKA_PASSWORD");

// IMPORTANT: use service role for inserts from a worker
const SUPABASE_URL = must("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

const FROM = (process.env.DARWIN_FROM || "latest").toLowerCase(); // "earliest" or "latest"
const MAX_MESSAGES = Number(process.env.DARWIN_MAX_MESSAGES || "200"); // per run loop (soft cap logging)
const RUN_MS = Number(process.env.DARWIN_RUN_MS || "120000"); // how long to keep it alive before restarting loop

const brokers = BROKERS_RAW.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((b) => b.replace(/^(sasl_ssl|ssl|plaintext):\/\//i, "")); // strip accidental schemes

const kafka = new Kafka({
  clientId: "fareguard-darwin-worker",
  brokers,
  ssl: true,
  sasl: { mechanism: "plain", username, password },
  connectionTimeout: 30000,
  authenticationTimeout: 30000,
  requestTimeout: 60000,
  retry: { initialRetryTime: 300, maxRetryTime: 5000, retries: 20 },
  logLevel: logLevel.INFO,
});

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminProbe() {
  const admin = kafka.admin();
  await admin.connect();

  const cluster = await admin.describeCluster();
  console.log("[darwin] cluster:", {
    clusterId: cluster.clusterId,
    brokers: cluster.brokers?.length,
    controller: cluster.controller,
  });

  const meta = await admin.fetchTopicMetadata({ topics: [topic] });
  const t = meta.topics?.[0];
  console.log("[darwin] topic metadata:", {
    topic,
    partitions: t?.partitions?.length,
    partitionIds: t?.partitions?.map((p) => p.partitionId),
  });

  await admin.disconnect();
}

async function insertMessage({ topic, partition, message }) {
  const valueStr = message.value ? message.value.toString("utf8") : "";
  let payload;

  // Darwin push is JSON on your topic, but be defensive:
  try {
    payload = valueStr ? JSON.parse(valueStr) : { raw: null };
  } catch {
    payload = { raw: valueStr };
  }

  const headersObj = {};
  if (message.headers) {
    for (const [k, v] of Object.entries(message.headers)) {
      if (Array.isArray(v)) headersObj[k] = v.map((x) => (Buffer.isBuffer(x) ? x.toString("utf8") : String(x)));
      else if (Buffer.isBuffer(v)) headersObj[k] = v.toString("utf8");
      else if (v == null) headersObj[k] = null;
      else headersObj[k] = String(v);
    }
  }

  const row = {
    topic,
    partition,
    kafka_offset: Number(message.offset),
    message_key: message.key ? message.key.toString("utf8") : null,
    payload,
    headers: Object.keys(headersObj).length ? headersObj : null,
  };

  const { error } = await db
    .from("darwin_messages")
    .upsert(row, { onConflict: "topic,partition,kafka_offset" });

  if (error) throw error;
}

async function runOnce() {
  // 1) Prove we can see the cluster + topic partitions
  await adminProbe();

  // 2) Start consuming
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();

  console.log("[darwin] connected.", { topic, groupId, from: FROM, brokers });

  await consumer.subscribe({
    topic,
    fromBeginning: FROM === "earliest",
  });

  let received = 0;
  let inserted = 0;

  // Kill-switch so we don’t “hang forever” during testing
  const stopAt = Date.now() + RUN_MS;
  const stopTimer = setInterval(async () => {
    if (Date.now() > stopAt) {
      console.log("[darwin] timebox hit, stopping consumer…", { received, inserted });
      try {
        await consumer.stop();
        await consumer.disconnect();
      } catch {}
      clearInterval(stopTimer);
    }
  }, 2000);

  await consumer.run({
    partitionsConsumedConcurrently: 1,
    eachMessage: async ({ topic, partition, message }) => {
      received++;

      try {
        await insertMessage({ topic, partition, message });
        inserted++;
      } catch (e) {
        console.error("[darwin] insert failed:", e?.message || e);
      }

      if (received % 10 === 0) console.log("[darwin] progress:", { received, inserted });

      // soft cap for quick tests
      if (received >= MAX_MESSAGES) {
        console.log("[darwin] max messages reached, stopping…", { received, inserted });
        await consumer.stop();
        await consumer.disconnect();
        clearInterval(stopTimer);
      }
    },
  });

  console.log("[darwin] finished runOnce", { received, inserted });
}

async function main() {
  while (true) {
    try {
      await runOnce();
    } catch (e) {
      console.error("[darwin] runOnce crash:", e?.message || e);
    }
    // backoff
    await sleep(5000);
  }
}

main().catch((e) => {
  console.error("[darwin] fatal:", e?.message || e);
  process.exit(1);
});
