#!/usr/bin/env node
/** Authenticate as the reviewer. No service client or user-id override is available. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export function requirePublicKey(key: string): void {
  if (key.startsWith("sb_publishable_")) return;
  try {
    const claims = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString());
    if (claims.role === "anon") return;
  } catch { /* Fail closed. */ }
  throw new Error("Use a Supabase anon/publishable key, never a service or secret key");
}
export async function reviewDrill(id: string, email: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) required");
  requirePublicKey(key);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive terminal required for human review");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Reviewer: ${email}; database: ${new URL(url).origin}`);
    if (await terminal.question("Send sign-in code to this reviewer? Type yes: ") !== "yes") return;
    const sent = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (sent.error) throw sent.error;
    const token = (await terminal.question("Email sign-in code: ")).trim();
    const signed = await db.auth.verifyOtp({ email, token, type: "email" });
    if (signed.error) throw signed.error;
    const review = await db.rpc("get_drill_review", { p_drill_id: id });
    if (review.error) throw review.error;
    console.log(JSON.stringify(review.data, null, 2));
    console.log("Review every displayed field, safety requirement, source, and demonstration before deciding.");
    const decision = await terminal.question("Type approved or rejected (anything else cancels): ");
    if (decision !== "approved" && decision !== "rejected") return;
    const notes = await terminal.question("Review notes: ");
    const result = await db.rpc("approve_drill", { p_drill_id: id, p_content_sha256: review.data.content_sha256, p_decision: decision, p_notes: notes });
    if (result.error) throw result.error;
    console.log(`Recorded ${decision} as ${signed.data.user!.id}; decision ${result.data}`);
  } finally {
    terminal.close();
    await db.auth.signOut({ scope: "local" });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  new Command().requiredOption("--drill-id <uuid>").requiredOption("--email <email>")
    .action(async opts => { try { await reviewDrill(opts.drillId, opts.email); } catch (error) { console.error(error); process.exitCode = 1; } }).parse();
}
