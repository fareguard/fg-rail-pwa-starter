import { Kafka, logLevel } from "kafkajs";
import { createClient } from "@supabase/supabase-js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const BROKERS = must("DARWIN_KAFKA_BROKERS").split(",").map(s => s.trim()).filter(Boolean);
const TOPIC = must("DARWIN_KAFKA_TOPIC");
const GROUP_ID = must("DARWIN_KAFKA_GROUP_ID");
const USERNAME = must("DARWIN_KAFKA_USERNAME");
const PASSWORD = must("DARWIN_KAFKA_PASSWORD");

const SUPABASE_URL = must("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

const MAX_BATCH = Number(process.env.DARWIN_MAX_MESSAGES_PER_BATCH ?? "500");

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const kafka = new Kafka({
  clientId: "fareguard-darwin-worker",
  brokers: BROKERS,
  ssl: true,
  sasl: { mechanism: "plain", username: USERNAME, password: PASSWORD },
  logLevel: logLevel.INFO,
});

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

async function main() {
  const consumer = kafka.consumer({ groupId: GROUP_ID });

  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  console.log("[darwin] connected. topic=", TOPIC, "group=", GROUP_ID);

  let inserted = 0;
  let received = 0;

  await consumer.run({
    autoCommit: true,
    eachBatchAutoResolve: true,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
      for (const message of batch.messages) {
        received++;

        let payload = null;
        try {
          const s = message.value ? message.value.toString("utf8") : "";
          payload = s ? JSON.parse(s) : null;
        } catch {
          payload = { _raw: message.value ? message.value.toString("utf8") : null };
        }

        const row = {
          topic: batch.topic,
          partition: batch.partition,
          kafka_offset: BigInt(message.offset).toString(), // store safely
          message_key: message.key ? message.key.toString("utf8") : null,
          payload,
          headers: headersToJson(message.headers),
        };

        const didInsert = await insertRow(row);
        if (didInsert) inserted++;

        resolveOffset(message.offset);
        await heartbeat();

        if (inserted >= MAX_BATCH) break;
      }

      await commitOffsetsIfNecessary();
    },
  });

  // never reaches here normally
  console.log("[darwin] stopped", { received, inserted });
}

main().catch((e) => {
  console.error("[darwin] fatal", e);
  process.exit(1);
});
