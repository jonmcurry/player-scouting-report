import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const python = process.env.ENGINE_V2_PYTHON ?? path.join(".venv_engine_v2",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.warn(`SKIPPED engine-v2 tests: missing interpreter ${python}`);
} else {
  const temporaryRoot = path.resolve(".agent-tmp", "engine-v2-tests");
  mkdirSync(temporaryRoot, { recursive: true });
  const result = spawnSync(python, ["-B", "-m", "unittest", "discover", "-s", "scripts/engine_v2/tests", "-v"], {
    stdio: "inherit", env: { ...process.env, TMP: temporaryRoot, TEMP: temporaryRoot, TMPDIR: temporaryRoot,
      PYTHONDONTWRITEBYTECODE: "1", YOLO_OFFLINE: "1" },
  });
  process.exitCode = result.status ?? 1;
}
