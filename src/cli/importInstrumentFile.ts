#!/usr/bin/env node
/** Local-first Phase 7 file import. Consent and lab access must already be
 * recorded through an approved service process. No automatic attempt sync. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { buildInstrumentEnvelope, type InstrumentEnvelope } from "../services/instruments/envelope.js";
import { assertLocalSource } from "./exportDemoFixture.js";

export async function main(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .option("--file <path>", "provider-neutral CSV or JSON readings")
    .option("--format <csv|json>", "override file extension")
    .option("--player-id <uuid>").option("--consent-id <uuid>")
    .option("--session-id <uuid>", "optional same-player practice session")
    .option("--imported-by <uuid>", "enabled performance analyst user")
    .option("--provider <name>").option("--device-type <type>")
    .option("--device-model <name>").option("--firmware <version>")
    .option("--map-import <uuid>", "apply one reviewed mapping to an existing import")
    .option("--mapping-id <uuid>")
    .option("--commit", "write the verified import or mapping; default is local dry-run")
    .option("--allow-remote", "allow a non-local Supabase target when separately authorized");
  program.parse(argv);
  const opts = program.opts<Record<string, string | boolean | undefined>>();
  assertLocalSource(process.env.SUPABASE_URL, opts.allowRemote === true, "--allow-remote");
  if (opts.mapImport || opts.mappingId) {
    if (typeof opts.mapImport !== "string" || typeof opts.mappingId !== "string")
      throw new Error("--map-import and --mapping-id are required together");
    if (!opts.commit) { console.log("Dry run: mapping would be applied after independent review; no data written."); return; }
    const { data, error } = await getSupabaseClient().rpc("apply_instrument_mapping",
      { p_import_id: opts.mapImport, p_mapping_id: opts.mappingId });
    if (error) throw new Error(`mapping failed: ${error.message}`);
    console.log(`Applied reviewed mapping to ${String(data)} reading(s).`);
    return;
  }
  const required = ["file", "playerId", "consentId", "importedBy", "provider", "deviceType", "deviceModel", "firmware"];
  for (const key of required) if (typeof opts[key] !== "string") throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  const file = String(opts.file);
  const format = (opts.format || path.extname(file).slice(1).toLowerCase()) as "csv" | "json";
  if (format !== "csv" && format !== "json") throw new Error("file format must be csv or json");
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 2_000_000)
    throw new Error("file must be a regular file of 1 byte–2 MB");
  const envelope: InstrumentEnvelope = buildInstrumentEnvelope(fs.readFileSync(file), format, {
    playerId: String(opts.playerId), consentId: String(opts.consentId),
    sessionId: typeof opts.sessionId === "string" ? opts.sessionId : undefined,
    importedBy: String(opts.importedBy), provider: String(opts.provider),
    deviceType: String(opts.deviceType) as InstrumentEnvelope["deviceType"],
    deviceModel: String(opts.deviceModel), firmware: String(opts.firmware),
  });
  if (!opts.commit) {
    console.log(JSON.stringify({ dryRun: true, playerId: envelope.playerId,
      provider: envelope.provider, format, fileSha256: envelope.fileSha256,
      readingCount: envelope.readings.length, warnings: envelope.warnings }, null, 2));
    return;
  }
  const { data, error } = await getSupabaseClient().rpc("stage_instrument_import", { p_envelope: envelope });
  if (error) throw new Error(`import rejected: ${error.message}`);
  console.log(JSON.stringify({ importId: data, fileSha256: envelope.fileSha256,
    readingCount: envelope.readings.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
