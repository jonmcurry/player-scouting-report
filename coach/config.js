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
//
// Derived from whatever host loaded this page (not hardcoded to 127.0.0.1)
// so a phone on the same WiFi can load the coach app via this machine's LAN
// IP (e.g. http://192.168.1.231:5500/coach/) and reach the local Supabase
// stack too - Kong (supabase_kong container) already publishes to 0.0.0.0,
// so it's reachable at that same LAN IP on port 54321. Only correct for
// local dev, where both are served from this one machine - a real deployed
// Supabase project's URL is a fixed *.supabase.co hostname, not derived.
//
// Inside the Capacitor native shell (Android Emulator / iOS Simulator / a
// real device), window.location.hostname resolves to "localhost" meaning
// the DEVICE ITSELF, not this dev machine - there is no local Supabase
// stack running on the phone/emulator/simulator. Capacitor injects a global
// window.Capacitor with isNativePlatform(); when running natively, fall
// back to this dev machine's real LAN IP instead of window.location.hostname.
const isNativeShell =
  typeof window !== "undefined" &&
  !!window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === "function" &&
  window.Capacitor.isNativePlatform();

// This machine's LAN IP - already verified reachable (Kong on 54321, the
// GCS emulator on 4443) from a phone on the same WiFi. Update if the
// network changes.
const DEV_LAN_HOST = "192.168.1.231";

export const SUPABASE_URL = isNativeShell
  ? `http://${DEV_LAN_HOST}:54321`
  : `http://${window.location.hostname}:54321`;
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
