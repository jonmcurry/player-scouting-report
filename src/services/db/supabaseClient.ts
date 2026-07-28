/**
 * Supabase client for server-side CLI use (migrate/generate/ingest/analyze).
 *
 * Always uses SUPABASE_SERVICE_ROLE_KEY, which bypasses Row-Level Security
 * entirely - that's correct and required here, since these CLIs are the only
 * code in this project ever meant to read/write Supabase directly (see the
 * architecture note in supabase/migrations/00001_initial_schema.sql: the
 * public GitHub Pages output never talks to Supabase, only the `generate`
 * CLI does, server-side). This client must NEVER be imported into anything
 * that could ship to a browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example). " +
        "For local dev, run `npx supabase start` and copy its printed API_URL/SERVICE_ROLE_KEY.",
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
