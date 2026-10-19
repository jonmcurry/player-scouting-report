import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { selectEngine, assertEngineArtifacts, hasRotationMismatch, META_IDENTITY_ARTIFACTS, REQUIRED_V2_ARTIFACTS, V2_IDENTITY, workerTiming } from "./engineSelection.js";

// Pure config fixtures: no database client or network calls (parallel test suite).
const local = (url: string): NodeJS.ProcessEnv => ({ ["SUPABASE" + "_URL"]: url, ANALYSIS_ENGINE: "v2-exp" });

test("experimental identity requires the M3 event pipeline", () => {
  assert.equal(V2_IDENTITY.pipeline_version, "hitterloop-v2-exp-0.3.0");
  const artifacts = Object.fromEntries(REQUIRED_V2_ARTIFACTS.map(name => [name,
    META_IDENTITY_ARTIFACTS.has(name) ? { meta: V2_IDENTITY } : V2_IDENTITY]));
  assert.throws(() => assertEngineArtifacts({ ...artifacts,
    "metrics.json": { ...V2_IDENTITY, pipeline_version: "hitterloop-v2-exp-0.2.1" } }));
});

test("rotation comparison matches quadrants, normalizes negatives, and skips absent probe rotation", () => {
  for (const rotationDegrees of [0, 90, 180, 270]) {
    assert.equal(hasRotationMismatch(rotationDegrees, { rotationDegrees }), false);
    assert.equal(hasRotationMismatch(rotationDegrees - 360, { rotationDegrees }), false);
    assert.equal(hasRotationMismatch(rotationDegrees, { rotationDegrees: rotationDegrees - 360 }), false);
    assert.equal(hasRotationMismatch(rotationDegrees + 90, { rotationDegrees }), true);
  }
  assert.equal(hasRotationMismatch(90, null), false);
  assert.equal(hasRotationMismatch(90, { rotationDegrees: null }), false);
  assert.equal(hasRotationMismatch(null, { rotationDegrees: 0 }), true);
});

test("baseline descriptor exactly preserves previous constants on both platforms", () => {
  for (const platform of ["win32", "darwin"] as const) {
    for (const value of [undefined, "", "baseline"]) {
      const descriptor = selectEngine({ ANALYSIS_ENGINE: value }, platform);
      assert.equal(descriptor.python, path.join(".venv_pose3d", platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "python.exe" : "python"));
      assert.equal(descriptor.script, path.join("scripts", "pose3d", "run_pipeline.py"));
      assert.equal(descriptor.outDir("player", "clip"), path.join("frames", "player", "clip"));
      assert.equal(descriptor.requiresPose3d, true);
      assert.deepEqual(descriptor.progress, [["Stage 0/4", 30], ["Stage 0.5/4", 35], ["Stage 1/4", 45],
        ["Stage 2/4", 65], ["Stage 3/4", 75], ["Stage 3.5/4", 82], ["Stage 4/4", 88]]);
    }
  }
  assert.equal(selectEngine({ POSE3D_PYTHON: "custom" }).python, "custom");
});

test("experimental selector fails closed except nonproduction loopback", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const env = local(`http://${host}:54321`);
    assert.equal(selectEngine(env).requiresPose3d, false);
    assert.equal(selectEngine(env).outDir("p", "c"), path.join("frames", "p", "c", "engine_v2"));
    assert.throws(() => selectEngine({ ...env, NODE_ENV: "production" }));
  }
  for (const url of ["", "invalid", "https://example.com", "http://localhost.example.com", "http://localhost@evil.example"]) {
    assert.throws(() => selectEngine(local(url)));
  }
  assert.throws(() => selectEngine({ ANALYSIS_ENGINE: "unknown" }));
  assert.equal(selectEngine({ ...local("http://localhost"), ENGINE_V2_PYTHON: "custom" }).python, "custom");
});

test("artifact identity rejects absent, baseline, and mismatched artifacts individually", () => {
  const artifacts = Object.fromEntries(REQUIRED_V2_ARTIFACTS.map(name => [name, META_IDENTITY_ARTIFACTS.has(name) ? { meta: V2_IDENTITY } : V2_IDENTITY]));
  assert.doesNotThrow(() => assertEngineArtifacts(artifacts));
  for (const name of REQUIRED_V2_ARTIFACTS) {
    for (const value of [undefined, {}, { ...V2_IDENTITY, pipeline_version: "wrong" }, { meta: { ...V2_IDENTITY, engine: "baseline" } }]) {
      assert.throws(() => assertEngineArtifacts({ ...artifacts, [name]: value }));
    }
  }
});

test("timeout and heartbeat startup configuration is validated", () => {
  assert.deepEqual(workerTiming({}), { timeoutMs: 45 * 60000, heartbeatMs: 60000 });
  for (const value of ["0", "-1", "NaN", "Infinity", ""]) {
    assert.throws(() => workerTiming({ PIPELINE_TIMEOUT_MINUTES: value }));
    assert.throws(() => workerTiming({ CLAIM_HEARTBEAT_SECONDS: value }));
  }
  assert.throws(() => workerTiming({ CLAIM_HEARTBEAT_SECONDS: "450" }));
  assert.throws(() => workerTiming({ UPLOAD_QUEUE_STALE_CLAIM_MINUTES: "2" }));
});
