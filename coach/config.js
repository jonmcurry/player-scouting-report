// Supabase project connection info for the coach app. Unlike .env.example's
// SUPABASE_SERVICE_ROLE_KEY, the URL + anon key below are NOT secrets - the
// anon key is designed to be public/embedded in shipped client code (Row-
// Level Security, not key secrecy, is what actually protects data; see
// supabase/migrations/00001_initial_schema.sql's architecture note). Safe to
// commit.
//
// Currently set to local dev values (from `npx supabase start`'s own
// printed output). Before deploying this app for real coaches to use,
// replace both with your hosted Supabase project's values (Project Settings
// -> API), and make sure you've disabled open signup on that hosted
// project (Studio -> Auth -> Settings) - the local CLI default has
// self-service signup ON, which is fine for local testing but not for a
// small trusted-coach app with a publicly reachable login page.
export const SUPABASE_URL = "http://127.0.0.1:54321";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
