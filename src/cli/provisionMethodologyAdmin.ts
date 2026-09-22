#!/usr/bin/env node
/**
 * Admin script: grants or revokes methodology-admin access for one existing
 * auth user. Mirrors provisionCoach.ts's shape, but methodology admin is a
 * separate, global allowlist (methodology_admins) - NOT a coach_team_access
 * role. Being a coach or head coach does not imply methodology admin, and
 * this script never touches coach/team data.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (bypasses RLS - server-side only).
 *
 * Usage:
 *   npm run provision-methodology-admin -- --email coach@example.com --grant
 *   npm run provision-methodology-admin -- --email coach@example.com --revoke
 */
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

async function findUserByEmail(email: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const target = email.toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Listing users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < 200) return null;
    page++;
  }
}

export async function grantMethodologyAdmin(email: string, grantedBy: string | null = null): Promise<void> {
  const supabase = getSupabaseClient();
  const userId = await findUserByEmail(email);
  if (!userId) throw new Error(`No auth user found for email "${email}" - create the account first (e.g. via coach signup or Supabase Studio).`);

  const { error } = await supabase
    .from("methodology_admins")
    .upsert({ user_id: userId, created_by: grantedBy }, { onConflict: "user_id" });
  if (error) throw new Error(`Granting methodology admin: ${error.message}`);

  console.log(`Granted methodology-admin access to ${email} (${userId}).`);
}

export async function revokeMethodologyAdmin(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  const userId = await findUserByEmail(email);
  if (!userId) throw new Error(`No auth user found for email "${email}".`);

  const { error } = await supabase.from("methodology_admins").delete().eq("user_id", userId);
  if (error) throw new Error(`Revoking methodology admin: ${error.message}`);

  console.log(`Revoked methodology-admin access from ${email} (${userId}).`);
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--email <email>", "Existing auth user's email to grant/revoke methodology-admin access for")
    .option("--grant", "Grant methodology-admin access (default)")
    .option("--revoke", "Revoke methodology-admin access");
  program.parse(process.argv);
  const opts = program.opts<{ email: string; grant?: boolean; revoke?: boolean }>();

  if (opts.grant && opts.revoke) {
    console.error("Pass only one of --grant or --revoke.");
    process.exit(1);
  }

  try {
    if (opts.revoke) {
      await revokeMethodologyAdmin(opts.email);
    } else {
      await grantMethodologyAdmin(opts.email);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
