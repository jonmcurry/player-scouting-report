#!/usr/bin/env node
/**
 * Loads an exported real-data fixture (npm run export-demo-fixture) into
 * demo.demo_real_fixtures and controls which fixture version is the
 * canonical demo dataset (migrations 00036 + 00037).
 *
 * Loading and publishing are separate on purpose:
 *   - load: the database re-verifies the fixture by cloning it into a
 *     scratch team inside a rolled-back savepoint, then stores it as an
 *     immutable (fixtureId, fixtureVersion). Stored != visible: no visitor
 *     sees it until it's published.
 *   - publish: one atomic pointer switch (demo.demo_canonical) - every new or
 *     reset visitor gets exactly this fixture's team + player. Re-verified
 *     at publish time. Rolling back = publishing the previous version (or,
 *     explicitly, the fictional narrative).
 *
 * Local stack only by default (--allow-remote is a deliberate, separate
 * step). Media files are never uploaded by this command.
 *
 * Usage:
 *   npm run import-demo-fixture -- --fixture demo-export/<id>/fixture.json --verify-only
 *   npm run import-demo-fixture -- --fixture demo-export/<id>/fixture.json            # store (unpublished)
 *   npm run import-demo-fixture -- --fixture demo-export/<id>/fixture.json --publish  # store + publish atomically
 *   npm run import-demo-fixture -- --status
 *   npm run import-demo-fixture -- --rollback-to <fixtureId>@<fixtureVersion>
 *   npm run import-demo-fixture -- --rollback-fictional
 *   npm run import-demo-fixture -- --retire-stale      # end sessions cloned from anything but the current canonical
 */
import { Command } from "commander";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { fixtureContentSha256 } from "../services/demoExport/buildFixture.js";
import { hasErrors, validateFixture, type Fixture } from "../services/demoExport/validate.js";
import { assertLocalSource } from "./exportDemoFixture.js";

export function readAndCheckFixture(file: string): Fixture {
  const fx = JSON.parse(fs.readFileSync(file, "utf-8")) as Fixture;
  const hash = fixtureContentSha256(fx);
  if (fx.contentSha256 !== hash) throw new Error(`fixture content hash mismatch (file says ${fx.contentSha256}, content is ${hash}) - it was edited after export; re-export instead of hand-editing`);
  const findings = validateFixture(fx);
  if (hasErrors(findings)) {
    for (const f of findings.filter((x) => x.level === "error")) console.error(`  ERROR   [${f.code}] ${f.message}`);
    throw new Error("fixture failed validation - not loading");
  }
  return fx;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--fixture <path>", "fixture.json produced by export-demo-fixture")
    .option("--verify-only", "Run the database-side clone check without storing anything")
    .option("--publish", "After storing, make this fixture version the canonical demo dataset (atomic)")
    .option("--status", "Show the current canonical dataset and stored fixture versions")
    .option("--rollback-to <id@version>", "Publish a previously stored fixture version")
    .option("--rollback-fictional", "Explicitly publish the fictional narrative (emergency rollback only)")
    .option("--retire-stale", "End existing sessions cloned from anything other than the current canonical fixture")
    .option("--allow-remote", "Permit a non-local SUPABASE_URL (deliberately off by default)");
  program.parse(process.argv);
  const opts = program.opts<{ fixture?: string; verifyOnly?: boolean; publish?: boolean; status?: boolean; rollbackTo?: string; rollbackFictional?: boolean; retireStale?: boolean; allowRemote?: boolean }>();
  assertLocalSource(process.env.SUPABASE_URL, opts.allowRemote === true, "--allow-remote");
  const demo = getSupabaseClient().schema("demo");
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await demo.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  if (opts.status) {
    const canon = await demo.from("demo_canonical").select("mode, fixture_id, fixture_version, published_at").single();
    const stored = await demo.from("demo_real_fixtures").select("fixture_id, fixture_version, content_sha256, loaded_at").order("loaded_at");
    if (canon.error || stored.error) throw new Error(canon.error?.message ?? stored.error?.message);
    console.log(JSON.stringify({ canonical: canon.data, stored: stored.data }, null, 2));
    return;
  }
  if (opts.rollbackFictional) {
    console.log(JSON.stringify(await rpc("publish_demo_canonical", { p_fixture_id: null, p_fixture_version: null }), null, 2));
    console.log("\nCanonical dataset is now the fictional narrative (explicit rollback).");
    return;
  }
  if (opts.rollbackTo) {
    const at = opts.rollbackTo.lastIndexOf("@");
    if (at < 1) throw new Error("--rollback-to expects <fixtureId>@<fixtureVersion>");
    console.log(JSON.stringify(await rpc("publish_demo_canonical", { p_fixture_id: opts.rollbackTo.slice(0, at), p_fixture_version: opts.rollbackTo.slice(at + 1) }), null, 2));
    return;
  }
  if (opts.retireStale) {
    console.log(`Retired ${String(await rpc("retire_noncanonical_sessions", {}))} non-canonical session team(s).`);
    return;
  }
  if (!opts.fixture) throw new Error("pass --fixture <fixture.json>, --status, --rollback-to, --rollback-fictional, or --retire-stale");
  const fx = readAndCheckFixture(opts.fixture);
  if (fx.curation.localValidationOnly) {
    assertLocalSource(process.env.SUPABASE_URL, false, "(nothing - local-validation fixtures can never leave the local stack)");
    console.warn(`WARNING: ${fx.fixtureId} is LOCAL-VALIDATION-ONLY (no recorded publication consent, unconfirmed facts).`);
  }
  if (opts.verifyOnly) {
    console.log(JSON.stringify(await rpc("verify_real_fixture", { p_payload: fx }), null, 2));
    console.log(`
Fixture ${fx.fixtureId}@${fx.fixtureVersion} clones cleanly (nothing stored).`);
    return;
  }
  console.log(JSON.stringify(await rpc("load_real_fixture", { p_payload: fx, p_content_sha256: fx.contentSha256 }), null, 2));
  if (opts.publish) {
    console.log(JSON.stringify(await rpc("publish_demo_canonical", { p_fixture_id: fx.fixtureId, p_fixture_version: fx.fixtureVersion }), null, 2));
    console.log(`
Fixture ${fx.fixtureId}@${fx.fixtureVersion} stored and PUBLISHED - every new/reset visitor gets it.`);
  } else {
    console.log(`
Fixture ${fx.fixtureId}@${fx.fixtureVersion} stored, NOT published (use --publish or --rollback-to ${fx.fixtureId}@${fx.fixtureVersion}).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
