#!/usr/bin/env node
import { Command } from "commander";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { dispatchNotificationBatch } from "../services/notifications/dispatcher.js";
import { createHostedNotificationProvider } from "../services/notifications/hostedProvider.js";
import { createSupabaseNotificationDispatchStore } from "../services/notifications/supabaseDispatchStore.js";

const program = new Command().option("--once", "Dispatch one batch and exit")
  .option("--limit <count>", "Events claimed per batch", "50")
  .option("--poll-ms <milliseconds>", "Idle polling interval", "10000");
program.parse();
const options = program.opts<{ once?: boolean; limit: string; pollMs: string }>();
const limit = Number(options.limit);
const pollMs = Number(options.pollMs);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100");
if (!Number.isInteger(pollMs) || pollMs < 1000) throw new Error("--poll-ms must be at least 1000");

const db = getSupabaseClient();
const store = createSupabaseNotificationDispatchStore(db);
const provider = createHostedNotificationProvider(db);
do {
  const result = await dispatchNotificationBatch(store, provider, limit);
  if (result.claimed || result.failed) console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  if (options.once) break;
  if (!result.claimed) await new Promise((resolve) => setTimeout(resolve, pollMs));
} while (true);
