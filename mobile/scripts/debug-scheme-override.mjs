// Android debug assets override main assets; regenerate after every copy/sync.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function debugConfig(mainConfig) {
  if (mainConfig === null || typeof mainConfig !== "object" || Array.isArray(mainConfig)) {
    throw new TypeError("Capacitor config must be an object");
  }
  return {
    ...mainConfig,
    server: { ...mainConfig.server, androidScheme: "http" },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.env.CAPACITOR_PLATFORM_NAME === "android"
) {
  const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const mainPath = path.join(mobileDir, "android", "app", "src", "main", "assets", "capacitor.config.json");
  const debugPath = path.join(mobileDir, "android", "app", "src", "debug", "assets", "capacitor.config.json");
  const config = debugConfig(JSON.parse(readFileSync(mainPath, "utf8")));
  mkdirSync(path.dirname(debugPath), { recursive: true });
  writeFileSync(debugPath, JSON.stringify(config, null, "\t"), "utf8");
  console.log("Android debug assets: http WebView origin configured.");
}
