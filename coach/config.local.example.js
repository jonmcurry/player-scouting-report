// Copy this file to coach/config.local.js (gitignored - never commit real
// values there) to run the coach app inside the Capacitor native shell
// (Android Emulator / iOS Simulator / a real device) against a local
// `supabase start` stack on THIS dev machine.
//
// Only needed for the native-shell case: a regular browser (including one on
// a phone on the same WiFi) already derives the right host automatically
// from window.location.hostname - see coach/config.js's resolveConfig(). The
// native shell's webview reports window.location.hostname as "localhost",
// meaning the device/emulator itself, which has no Supabase stack running on
// it - so this has to be told your dev machine's real LAN IP explicitly.
//
// Loaded as a plain (non-module) <script> before shared.js's module script
// in every coach/*.html page, so it just needs to exist on disk - nothing
// else to wire up. Safe to be entirely absent (e.g. in CI, or once
// coach/config.js's PROD_SUPABASE_URL/KEY are filled in for a real deploy) -
// a missing script tag is a silent no-op in every browser.
window.__BARRELIQ_LOCAL_CONFIG__ = {
  lanHost: "REPLACE-WITH-YOUR-DEV-MACHINE-LAN-IP", // e.g. "192.168.1.231"
};
