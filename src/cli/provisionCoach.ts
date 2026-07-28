#!/usr/bin/env node
/**
 * Admin script: creates (or updates) one coach account with access to one
 * team. Coach accounts are NOT self-service signup - the coach app has no
 * registration flow on purpose (a small, trusted, owner-provisioned set of
 * adults, not an open product), so this script is the only path to a working
 * login. Safe to re-run: re-running for the same email updates the display
 * name and (re-)grants the given team's access rather than erroring or
 * duplicating.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (auth.admin.createUser is a
 * server-only Admin API call - never expose this key in a browser).
 *
 * Usage:
 *   npm run provision-coach -- --email coach@example.com --password "..." \
 *     --displayName "Coach Kayla" --team latham-lady-bison-white-10u
 */
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

async function findUserByEmail(email: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const target = email.toLowerCase();
  // No direct getUserByEmail in the Admin API - listUsers() is fine here,
  // this is a low-volume admin script (a handful of coaches), not a hot path.
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

export async function provisionCoach(
  email: string,
  password: string,
  displayName: string,
  teamSlug: string,
  role: "coach" | "head_coach" = "coach",
): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .select("id")
    .eq("slug", teamSlug)
    .single();
  if (teamErr || !team) {
    throw new Error(`No team found with slug "${teamSlug}" (${teamErr?.message ?? "not found"})`);
  }

  let userId = await findUserByEmail(email);
  if (userId) {
    console.log(`User ${email} already exists (${userId}) - updating profile/access, not recreating.`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // admin-provisioned and trusted - skip the email-confirmation flow
    });
    if (error || !data.user) {
      throw new Error(`Creating user ${email}: ${error?.message ?? "unknown error"}`);
    }
    userId = data.user.id;
    console.log(`Created new auth user ${email} (${userId}).`);
  }

  const { error: profileErr } = await supabase
    .from("coach_profiles")
    .upsert({ user_id: userId, display_name: displayName }, { onConflict: "user_id" });
  if (profileErr) throw new Error(`Upserting coach_profiles: ${profileErr.message}`);

  const { error: accessErr } = await supabase
    .from("coach_team_access")
    .upsert({ coach_id: userId, team_id: team.id, role }, { onConflict: "coach_id,team_id" });
  if (accessErr) throw new Error(`Upserting coach_team_access: ${accessErr.message}`);

  console.log(`Provisioned ${displayName} <${email}> as "${role}" on team "${teamSlug}".`);
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--email <email>", "Coach's login email")
    .requiredOption("--password <password>", "Coach's initial password")
    .requiredOption("--displayName <name>", "Display name shown on confirmed-score badges")
    .requiredOption("--team <slug>", "Team slug to grant access to")
    .option("--role <role>", "coach or head_coach", "coach");
  program.parse(process.argv);
  const opts = program.opts<{
    email: string;
    password: string;
    displayName: string;
    team: string;
    role: string;
  }>();

  if (opts.role !== "coach" && opts.role !== "head_coach") {
    console.error(`--role must be "coach" or "head_coach", got "${opts.role}"`);
    process.exit(1);
  }

  try {
    await provisionCoach(opts.email, opts.password, opts.displayName, opts.team, opts.role);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
