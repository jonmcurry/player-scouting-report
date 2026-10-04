// The optional coach/demo.local.js is for browser-only demo testing. Capacitor
// copies every file in webDir, including ignored local files, into the APK.
// Remove only the generated Android copy after each Capacitor copy/sync.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.env.CAPACITOR_PLATFORM_NAME === "android") {
  const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const generatedDemo = path.join(mobileDir, "android", "app", "src", "main", "assets", "public", "demo.local.js");
  rmSync(generatedDemo, { force: true });
  console.log("Android assets: local browser demo override excluded.");
}
