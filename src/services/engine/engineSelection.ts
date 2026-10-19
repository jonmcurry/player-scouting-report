import path from "node:path";

export const V2_IDENTITY = Object.freeze({ engine: "hitterloop-engine-v2-exp", pipeline_version: "hitterloop-v2-exp-0.3.0" });
export const BASELINE_PROGRESS: ReadonlyArray<readonly [string, number]> = [
  ["Stage 0/4", 30], ["Stage 0.5/4", 35], ["Stage 1/4", 45],
  ["Stage 2/4", 65], ["Stage 3/4", 75], ["Stage 3.5/4", 82], ["Stage 4/4", 88],
];

export function selectEngine(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  const name = env.ANALYSIS_ENGINE || "baseline";
  if (name !== "baseline" && name !== "v2-exp") throw new Error(`Unknown ANALYSIS_ENGINE: ${name}`);
  if (name === "v2-exp") {
    let host = "";
    try { host = new URL(env.SUPABASE_URL ?? "").hostname; } catch { /* fail closed below */ }
    if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
      throw new Error("v2-exp requires loopback SUPABASE_URL and non-production NODE_ENV");
    }
  }
  const v2 = name === "v2-exp";
  return {
    name,
    python: (v2 ? env.ENGINE_V2_PYTHON : env.POSE3D_PYTHON) ?? path.join(v2 ? ".venv_engine_v2" : ".venv_pose3d",
      platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "python.exe" : "python"),
    script: path.join("scripts", v2 ? "engine_v2" : "pose3d", v2 ? "run_engine.py" : "run_pipeline.py"),
    outDir: (player: string, clip: string) => v2 ? path.join("frames", player, clip, "engine_v2") : path.join("frames", player, clip),
    requiresPose3d: !v2,
    progress: v2 ? [
      ["[engine_v2] Stage 1/3 decode+track", 45], ["[engine_v2] Stage 2/3 batter", 75],
      ["[engine_v2] Stage 3/3 write", 88],
    ] as ReadonlyArray<readonly [string, number]> : BASELINE_PROGRESS,
  };
}

// pose_2d and bat_path carry identity in `meta`; every other artifact at the top level.
export const META_IDENTITY_ARTIFACTS: ReadonlySet<string> = new Set(["pose_2d.json", "bat_path.json"]);
export const REQUIRED_V2_ARTIFACTS = ["pipeline_status.json", "metrics.json", "pose_2d.json", "bat_path.json", "frame_map.json", "engine_manifest.json"] as const;

export function hasRotationMismatch(frameMapRotation: unknown,
  media: { rotationDegrees: number | null } | null): boolean {
  if (!media || typeof media.rotationDegrees !== "number") return false;
  const normalize = (rotation: number) => ((rotation % 360) + 360) % 360;
  return typeof frameMapRotation !== "number" || normalize(frameMapRotation) !== normalize(media.rotationDegrees);
}

/** Validate the entire set before consumers use any analysis data. */
export function assertEngineArtifacts(artifacts: Record<string, unknown>): void {
  for (const name of REQUIRED_V2_ARTIFACTS) {
    const value = artifacts[name] as Record<string, unknown> | undefined;
    const identity = META_IDENTITY_ARTIFACTS.has(name) ? value?.meta as Record<string, unknown> | undefined : value;
    if (!identity || identity.engine !== V2_IDENTITY.engine || identity.pipeline_version !== V2_IDENTITY.pipeline_version) {
      throw new Error(`Invalid experimental engine artifact identity: ${name}`);
    }
  }
}

export function workerTiming(env: NodeJS.ProcessEnv = process.env) {
  const positive = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
    return value;
  };
  const timeoutMs = positive("PIPELINE_TIMEOUT_MINUTES", 45) * 60_000;
  const heartbeatMs = positive("CLAIM_HEARTBEAT_SECONDS", 60) * 1000;
  const staleMs = positive("UPLOAD_QUEUE_STALE_CLAIM_MINUTES", 15) * 60_000;
  if (heartbeatMs >= staleMs / 2) throw new Error("CLAIM_HEARTBEAT_SECONDS must be less than half the stale-claim interval");
  if (timeoutMs > 2_147_483_647 || heartbeatMs > 2_147_483_647) throw new Error("Worker timer exceeds supported interval");
  return { timeoutMs, heartbeatMs };
}
