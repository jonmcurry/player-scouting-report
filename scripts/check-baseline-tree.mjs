/** PR1 source-preservation gate. No Python execution, Git writes, or network. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BASELINE = Object.freeze({
  tag: "engine-baseline-1.0.0",
  commit: "f79b09e63092e87efd1250c3b263d29086d81a79",
  tree: "766f4fbc64620d428da428e59b144554ca2f2a7b",
  pipelineVersion: "pose3d-live-1.0.0",
});
const ENGINE_PATH = "scripts/pose3d";
const POLICY_PATH = "docs/architecture/ENGINE_BASELINE.md";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => { throw new Error(`Baseline guard: ${message}`); };
const requireThat = (condition, message) => { if (!condition) fail(message); };
const oid = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const same = (a, b) => a?.blob === b?.blob && a?.mode === b?.mode;

function git(root, args) {
  try {
    return execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { fail(`Git verification failed (${args[0]}). Required baseline objects/tag must be available; no HEAD fallback is allowed.`); }
}

function keys(value, expected, label) {
  requireThat(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  requireThat(Object.keys(value).sort().join(",") === [...expected].sort().join(","), `${label} has missing or unknown fields`);
}

export function readBaselinePolicy(markdown) {
  const blocks = [...markdown.matchAll(/<!-- baseline-policy:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- baseline-policy:end -->/g)];
  requireThat(blocks.length === 1, "exactly one baseline-policy JSON block is required");
  try { return JSON.parse(blocks[0][1]); } catch { fail("baseline-policy JSON is invalid"); }
}

function safePath(value, prefix) {
  requireThat(typeof value === "string" && value.startsWith(`${prefix}/`) &&
    value.split("/").every((part) => part && part !== "." && part !== "..") &&
    !/[\\\x00-\x1f:*?\[\]]/.test(value), `invalid exact path: ${value}`);
}

function regularFile(root, relative) {
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    requireThat(!stat.isSymbolicLink(), `symlink is not permitted: ${relative}`);
    requireThat(index === parts.length - 1 ? stat.isFile() : stat.isDirectory(), `not a regular file path: ${relative}`);
  }
  return fs.readFileSync(current);
}

function state(value, label) {
  if (value === null) return;
  keys(value, ["blob", "mode"], label);
  requireThat(oid(value.blob) && ["100644", "100755"].includes(value.mode), `${label} requires a Git blob SHA and regular-file mode`);
}

function expectedTree(root, policy, original) {
  keys(policy, ["schemaVersion", "baseline", "engineCodeVersion", "pipelineVersion", "instrumentationVersion", "environmentVersion", "exceptions"], "policy");
  keys(policy.baseline, Object.keys(BASELINE), "baseline");
  requireThat(Object.entries(BASELINE).every(([key, value]) => policy.baseline[key] === value), "unknown baseline identity; the original commit/tree/tag cannot be redefined");
  requireThat(policy.schemaVersion === 1 && Array.isArray(policy.exceptions), "unsupported policy schema");
  requireThat(policy.environmentVersion === "uncaptured" || /^env-[a-f0-9]{12}$/.test(policy.environmentVersion), "invalid environment version");
  const expected = new Map(original);
  let patch = 0, instrumentation = 0;
  const ids = new Set();
  for (const entry of policy.exceptions) {
    const common = ["id", "kind", "reason", "validation", "approval", "files"];
    requireThat(entry?.kind === "instrumentation" || entry?.kind === "maintenance", "unknown exception kind");
    keys(entry, [...common, ...(entry.kind === "instrumentation" ? ["instrumentationVersion"] :
      ["category", "engineCodeVersion", "pipelineVersion"])], "exception");
    requireThat(text(entry.id) && !ids.has(entry.id), "exception IDs must be nonempty and unique");
    ids.add(entry.id);
    requireThat(text(entry.reason) && text(entry.validation), "exception requires a reason and validation evidence description");
    keys(entry.approval, ["approvedBy", "document", "sha256"], "approval");
    requireThat(text(entry.approval.approvedBy), "documented approval requires a named approver");
    safePath(entry.approval.document, "docs/architecture/engine-approvals");
    requireThat(entry.approval.document.endsWith(".md"), "approval must reference a Markdown record");
    const approval = regularFile(root, entry.approval.document);
    requireThat(approval.length > 0 && /^[a-f0-9]{64}$/.test(entry.approval.sha256) &&
      createHash("sha256").update(approval).digest("hex") === entry.approval.sha256,
    "approval document hash mismatch");
    if (entry.kind === "instrumentation") {
      instrumentation++;
      requireThat(entry.instrumentationVersion === `inst-${instrumentation}`, "instrumentation requires the next separate inst-N version");
    } else {
      patch++;
      requireThat(["security", "crash"].includes(entry.category), "maintenance is limited to security/crash fixes");
      requireThat(entry.engineCodeVersion === `engine-baseline-1.0.${patch}` &&
        entry.pipelineVersion === `pose3d-live-1.0.${patch}`, "maintenance requires the next engine and pipeline patch versions");
    }
    requireThat(Array.isArray(entry.files) && entry.files.length > 0, "exception must list exact changed files");
    const paths = new Set();
    for (const file of entry.files) {
      keys(file, ["path", "before", "after"], "file exception");
      safePath(file.path, ENGINE_PATH);
      requireThat(!paths.has(file.path), "duplicate path in exception");
      paths.add(file.path);
      state(file.before, "before"); state(file.after, "after");
      requireThat(!same(file.before, file.after), "exception cannot register an unchanged file");
      requireThat(same(expected.get(file.path), file.before), `exception has unknown predecessor: ${file.path}`);
      if (file.after === null) expected.delete(file.path);
      else expected.set(file.path, file.after);
    }
  }
  requireThat(policy.engineCodeVersion === `engine-baseline-1.0.${patch}` &&
    policy.pipelineVersion === `pose3d-live-1.0.${patch}`, "active engine version does not match approved maintenance history");
  requireThat(policy.instrumentationVersion === (instrumentation ? `inst-${instrumentation}` : "none"), "active instrumentation version does not match registered history");
  return expected;
}

function originalTree(root) {
  requireThat(git(root, ["rev-parse", "--verify", `${BASELINE.commit}^{commit}`]).trim() === BASELINE.commit, "original commit mismatch");
  requireThat(git(root, ["cat-file", "-t", `refs/tags/${BASELINE.tag}`]).trim() === "tag", "baseline tag must be annotated");
  requireThat(git(root, ["rev-parse", "--verify", `refs/tags/${BASELINE.tag}^{commit}`]).trim() === BASELINE.commit, "baseline tag points to a different commit");
  requireThat(git(root, ["rev-parse", `${BASELINE.commit}:${ENGINE_PATH}`]).trim() === BASELINE.tree &&
    git(root, ["rev-parse", `refs/tags/${BASELINE.tag}:${ENGINE_PATH}`]).trim() === BASELINE.tree, "baseline tree hash mismatch");
  const result = new Map();
  for (const row of git(root, ["ls-tree", "-r", "-z", BASELINE.commit, "--", ENGINE_PATH]).split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    requireThat(match, "baseline contains unsupported tree entries");
    result.set(match[3], { mode: match[1], blob: match[2] });
  }
  requireThat(result.size > 0, "baseline tree is empty");
  return result;
}

function workingFiles(root, relative = ENGINE_PATH, found = []) {
  requireThat(fs.lstatSync(path.join(root, relative)).isDirectory() &&
    !fs.lstatSync(path.join(root, relative)).isSymbolicLink(), `engine directory is missing or a symlink: ${relative}`);
  for (const name of fs.readdirSync(path.join(root, relative))) {
    const rel = `${relative}/${name}`;
    const stat = fs.lstatSync(path.join(root, rel));
    requireThat(!stat.isSymbolicLink(), `symlink is not permitted: ${rel}`);
    if (stat.isDirectory()) workingFiles(root, rel, found);
    // Interpreter caches are environment artifacts, never source exceptions.
    else if (!/\/__pycache__\/[^/]+\.pyc$/.test(rel)) {
      requireThat(stat.isFile(), `unsupported filesystem entry: ${rel}`);
      found.push(rel);
    }
  }
  return found;
}

function blobHash(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Tests can supply an isolated checkout; the trusted baseline is never configurable. */
export function checkBaseline(root = ROOT) {
  const original = originalTree(root);
  const policy = readBaselinePolicy(regularFile(root, POLICY_PATH).toString("utf8"));
  const expected = expectedTree(root, policy, original);
  const indexed = new Map();
  for (const row of git(root, ["ls-files", "--stage", "-z", "--", ENGINE_PATH]).split("\0").filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]{40}) (\d)\t(.+)$/.exec(row);
    requireThat(match && match[3] === "0", "unmerged/invalid engine index entry");
    indexed.set(match[4], { mode: match[1], blob: match[2] });
  }
  // Catch a staged edit even if the worktree has subsequently been restored.
  for (const rel of new Set([...original.keys(), ...expected.keys(), ...indexed.keys()])) {
    requireThat(same(indexed.get(rel), original.get(rel)) || same(indexed.get(rel), expected.get(rel)),
      `unauthorized staged engine change: ${rel}`);
  }
  const actualPaths = workingFiles(root);
  requireThat(actualPaths.length === expected.size && actualPaths.every((rel) => expected.has(rel)),
    "unregistered added/deleted engine files (including ignored source files)");
  for (const rel of actualPaths) {
    const bytes = regularFile(root, rel);
    const record = expected.get(rel);
    // Git commonly checks text out as CRLF on Windows. Only line endings may
    // normalize; no clean filters, whitespace trimming, or Python parsing.
    const canonical = bytes.includes(0) ? bytes : Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
    requireThat(blobHash(bytes) === record.blob || blobHash(canonical) === record.blob, `unauthorized engine content: ${rel}`);
    const mode = process.platform === "win32" ? (indexed.get(rel)?.mode ?? record.mode) :
      (fs.statSync(path.join(root, rel)).mode & 0o111 ? "100755" : "100644");
    requireThat(mode === record.mode, `unauthorized executable mode: ${rel}`);
  }
  const orchestrator = regularFile(root, `${ENGINE_PATH}/run_pipeline.py`).toString("utf8");
  const stamps = [...orchestrator.matchAll(/^PIPELINE_VERSION\s*=\s*["']([^"']+)["']\s*$/gm)];
  requireThat(stamps.length === 1 && stamps[0][1] === policy.pipelineVersion, "pipeline version stamp does not match registered engine version");
  return { ...BASELINE, files: expected.size, engineCodeVersion: policy.engineCodeVersion,
    instrumentationVersion: policy.instrumentationVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireThat(process.argv.length === 2, "no baseline overrides or bypass flags are supported");
    const result = checkBaseline();
    console.log(`Baseline verified: ${result.commit} / ${result.tree}; ${result.files} files; ${result.engineCodeVersion}, instrumentation ${result.instrumentationVersion}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
