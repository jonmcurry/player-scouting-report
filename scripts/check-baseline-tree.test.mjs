import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASELINE, checkBaseline, readBaselinePolicy } from "./check-baseline-tree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = "docs/architecture/ENGINE_BASELINE.md";
const doc = fs.readFileSync(path.join(root, policyPath), "utf8");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (cwd, rel, value) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), value);
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hitterloop-baseline-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Local object sharing: no remote, model, video, or production service.
  git(root, "clone", "--quiet", "--shared", "--no-checkout", "--", root, dir);
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "config", "core.filemode", "true");
  git(dir, "config", "user.name", "Synthetic baseline test");
  git(dir, "config", "user.email", "baseline-test@example.invalid");
  git(dir, "checkout", BASELINE.commit, "--", "scripts/pose3d");
  write(dir, policyPath, doc);
  return dir;
}
function policy(dir, edit) {
  const value = readBaselinePolicy(fs.readFileSync(path.join(dir, policyPath), "utf8"));
  edit(value);
  write(dir, policyPath, `<!-- baseline-policy:start -->\n\x60\x60\x60json\n${JSON.stringify(value, null, 2)}\n\x60\x60\x60\n<!-- baseline-policy:end -->\n`);
}
function approval(dir) {
  const document = "docs/architecture/engine-approvals/synthetic-test.md";
  const content = "Synthetic fixture only: test reviewer approves the exact test revision and its regression evidence.\n";
  write(dir, document, content);
  return { approvedBy: "Synthetic test reviewer", document,
    sha256: createHash("sha256").update(content).digest("hex") };
}
function instrument(dir) {
  const rel = "scripts/pose3d/instrumentation/synthetic.py";
  write(dir, rel, "# Synthetic non-executed instrumentation fixture\n");
  const entry = { id: "synthetic-inst-1", kind: "instrumentation", instrumentationVersion: "inst-1",
    reason: "Exercise the explicit instrumentation registration path.", validation: "Synthetic fixture has no algorithm effect.",
    approval: approval(dir), files: [{ path: rel, before: null,
      after: { blob: git(dir, "hash-object", "--no-filters", rel), mode: "100644" } }] };
  policy(dir, (p) => { p.instrumentationVersion = "inst-1"; p.exceptions.push(entry); });
  return rel;
}
function maintain(dir) {
  const rel = "scripts/pose3d/run_pipeline.py";
  const before = { blob: git(dir, "rev-parse", `${BASELINE.commit}:${rel}`), mode: "100644" };
  const source = fs.readFileSync(path.join(dir, rel), "utf8");
  write(dir, rel, source.replace('PIPELINE_VERSION = "pose3d-live-1.0.0"', 'PIPELINE_VERSION = "pose3d-live-1.0.1"'));
  const entry = { id: "synthetic-maintenance", kind: "maintenance", category: "crash",
    engineCodeVersion: "engine-baseline-1.0.1", pipelineVersion: "pose3d-live-1.0.1",
    reason: "Synthetic version-registration test; no real maintenance is approved.",
    validation: "Synthetic stamp-only fixture exercises maintenance governance.", approval: approval(dir),
    files: [{ path: rel, before, after: { blob: git(dir, "hash-object", "--no-filters", rel), mode: "100644" } }] };
  policy(dir, (p) => { p.engineCodeVersion = entry.engineCodeVersion; p.pipelineVersion = entry.pipelineVersion; p.exceptions.push(entry); });
}

test("recorded original commit, annotated tag and tree match the real repository", () => {
  const result = checkBaseline(root);
  assert.equal(result.commit, BASELINE.commit);
  assert.equal(result.tree, BASELINE.tree);
  assert.equal(git(root, "cat-file", "-t", `refs/tags/${BASELINE.tag}`), "tag");
});
test("unchanged source passes, including Windows CRLF-only checkout", (t) => {
  const dir = fixture(t);
  assert.equal(checkBaseline(dir).files, 13);
  const rel = "scripts/pose3d/metrics.py";
  write(dir, rel, fs.readFileSync(path.join(dir, rel), "utf8").replaceAll("\n", "\r\n"));
  assert.equal(checkBaseline(dir).files, 13);
});
test("algorithm edits and staged edits hidden by a restored working copy are rejected", (t) => {
  const dir = fixture(t), rel = "scripts/pose3d/metrics.py";
  const original = fs.readFileSync(path.join(dir, rel));
  write(dir, rel, Buffer.concat([original, Buffer.from("\nUNAUTHORIZED_THRESHOLD = 123\n")]));
  assert.throws(() => checkBaseline(dir), /unauthorized engine content/);
  git(dir, "add", "--", rel);
  write(dir, rel, original);
  assert.throws(() => checkBaseline(dir), /unauthorized staged engine change/);
});
test("untracked and ignored source additions, deletions, and symlinks cannot bypass the guard", (t) => {
  const dir = fixture(t), rel = "scripts/pose3d/hidden.py";
  write(dir, ".gitignore", "scripts/pose3d/hidden.py\n"); write(dir, rel, "hidden = True\n");
  assert.throws(() => checkBaseline(dir), /unregistered added\/deleted/);
  fs.unlinkSync(path.join(dir, rel));
  const target = path.join(dir, "scripts/pose3d/metrics.py"), original = fs.readFileSync(target);
  fs.unlinkSync(target);
  assert.throws(() => checkBaseline(dir), /unregistered added\/deleted/);
  if (process.platform !== "win32") {
    fs.symlinkSync("detect_2d.py", target);
    assert.throws(() => checkBaseline(dir), /symlink/);
    fs.unlinkSync(target);
  }
  fs.writeFileSync(target, original);
  write(dir, "scripts/pose3d/__pycache__/metrics.cpython-312.pyc", Buffer.from([0, 1]));
  assert.equal(checkBaseline(dir).files, 13);
  write(dir, "scripts/pose3d/__pycache__/hidden.py", "hidden = True\n");
  assert.throws(() => checkBaseline(dir), /unregistered added\/deleted/);
});
test("exact instrumentation registration passes and later edits to that file fail", (t) => {
  const dir = fixture(t), rel = instrument(dir);
  assert.equal(checkBaseline(dir).instrumentationVersion, "inst-1");
  git(dir, "add", "--", rel);
  assert.equal(checkBaseline(dir).files, 14);
  fs.appendFileSync(path.join(dir, rel), "UNREVIEWED = True\n");
  assert.throws(() => checkBaseline(dir), /unauthorized engine content/);
});
test("instrumentation cannot blanket-allow another algorithm edit or omit its version", (t) => {
  const dir = fixture(t); instrument(dir);
  fs.appendFileSync(path.join(dir, "scripts/pose3d/metrics.py"), "\nUNREVIEWED = True\n");
  assert.throws(() => checkBaseline(dir), /unauthorized engine content/);
  policy(dir, (p) => { p.instrumentationVersion = "none"; });
  assert.throws(() => checkBaseline(dir), /instrumentation version/);
});
test("maintenance requires a documented approval, allowed category and next patch versions", (t) => {
  const dir = fixture(t); maintain(dir);
  assert.equal(checkBaseline(dir).engineCodeVersion, "engine-baseline-1.0.1");
  policy(dir, (p) => { p.exceptions[0].engineCodeVersion = BASELINE.tag; });
  assert.throws(() => checkBaseline(dir), /next engine and pipeline patch/);
  policy(dir, (p) => { p.exceptions[0].engineCodeVersion = "engine-baseline-1.0.1"; p.exceptions[0].category = "accuracy"; });
  assert.throws(() => checkBaseline(dir), /security\/crash/);
  policy(dir, (p) => { p.exceptions[0].category = "crash"; p.exceptions[0].approval.approvedBy = ""; });
  assert.throws(() => checkBaseline(dir), /named approver/);
  policy(dir, (p) => { p.exceptions[0].approval.approvedBy = "Synthetic test reviewer"; });
  fs.appendFileSync(path.join(dir, "docs/architecture/engine-approvals/synthetic-test.md"), "changed\n");
  assert.throws(() => checkBaseline(dir), /approval document hash mismatch/);
  fs.unlinkSync(path.join(dir, "docs/architecture/engine-approvals/synthetic-test.md"));
  assert.throws(() => checkBaseline(dir), /ENOENT/);
});
test("maintenance cannot register a patch version without updating the actual pipeline stamp", (t) => {
  const dir = fixture(t); maintain(dir);
  const rel = "scripts/pose3d/run_pipeline.py";
  const original = git(dir, "show", `${BASELINE.commit}:${rel}`) + "\n# synthetic security fix\n";
  write(dir, rel, original);
  policy(dir, (p) => { p.exceptions[0].files[0].after.blob = git(dir, "hash-object", "--no-filters", rel); });
  assert.throws(() => checkBaseline(dir), /pipeline version stamp/);
});
test("unknown baseline, unknown active engine, and unknown predecessor fail closed", (t) => {
  const dir = fixture(t);
  policy(dir, (p) => { p.baseline.commit = "0".repeat(40); });
  assert.throws(() => checkBaseline(dir), /unknown baseline identity/);
  write(dir, policyPath, doc);
  policy(dir, (p) => { p.baseline.tree = "0".repeat(40); });
  assert.throws(() => checkBaseline(dir), /unknown baseline identity/);
  write(dir, policyPath, doc);
  policy(dir, (p) => { p.engineCodeVersion = "engine-v2"; });
  assert.throws(() => checkBaseline(dir), /active engine version/);
  write(dir, policyPath, doc); instrument(dir);
  policy(dir, (p) => { p.exceptions[0].files[0].before = { blob: "0".repeat(40), mode: "100644" }; });
  assert.throws(() => checkBaseline(dir), /unknown predecessor/);
});
test("missing, lightweight and moved tags cannot silently choose another baseline", (t) => {
  const dir = fixture(t);
  git(dir, "tag", "-d", BASELINE.tag);
  assert.throws(() => checkBaseline(dir), /Required baseline objects\/tag/);
  git(dir, "-c", "tag.gpgSign=false", "tag", BASELINE.tag, BASELINE.commit);
  assert.throws(() => checkBaseline(dir), /must be annotated/);
  git(dir, "tag", "-d", BASELINE.tag);
  git(dir, "-c", "tag.gpgSign=false", "tag", "-a", BASELINE.tag, `${BASELINE.commit}^`, "-m", "Synthetic incorrect target");
  assert.throws(() => checkBaseline(dir), /different commit/);
});
test("CLI rejects baseline override flags and missing original history fails closed", (t) => {
  assert.throws(() => execFileSync(process.execPath,
    [path.join(root, "scripts/check-baseline-tree.mjs"), "--baseline", "HEAD"],
    { cwd: root, stdio: "pipe" }), (error) => error.status === 1 && /no baseline overrides/.test(String(error.stderr)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hitterloop-unknown-baseline-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "--quiet");
  write(dir, policyPath, doc);
  assert.throws(() => checkBaseline(dir), /Required baseline objects\/tag/);
});
test("wildcard exceptions, executable changes and malformed policies are rejected", (t) => {
  const dir = fixture(t); instrument(dir);
  policy(dir, (p) => { p.exceptions[0].files[0].path = "scripts/pose3d/*.py"; });
  assert.throws(() => checkBaseline(dir), /invalid exact path/);
  write(dir, policyPath, doc);
  fs.rmSync(path.join(dir, "scripts/pose3d/instrumentation"), { recursive: true });
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(dir, "scripts/pose3d/metrics.py"), 0o755);
    assert.throws(() => checkBaseline(dir), /executable mode/);
  }
  assert.throws(() => readBaselinePolicy("no policy"), /exactly one/);
  assert.throws(() => readBaselinePolicy(doc + doc), /exactly one/);
});
