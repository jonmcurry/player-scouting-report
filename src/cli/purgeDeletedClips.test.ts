import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { purgeDeletedClips, retryUnfinishedDeletions, isOwnRawObject, UNFINISHED_RETRY_AFTER_MS, type PurgeDb, type RetryDb } from "./purgeDeletedClips.js";

interface Row { clip_id: string; player_slug: string; clip_slug: string; local_purged_at: string | null; gcs_deleted_at?: string | null }
const DONE = "2026-10-02T00:00:00Z";

/** In-memory stand-in for the two clip_deletions queries purgeDeletedClips makes. */
function fakeDb(rows: Row[]): PurgeDb & { stamps: string[] } {
  const stamps: string[] = [];
  return {
    stamps,
    async pendingPurges() {
      // Deliberately NOT filtering on gcs_deleted_at: purgeDeletedClips must skip unfinished rows itself.
      return rows.filter((r) => r.local_purged_at === null)
        .map(({ clip_id, player_slug, clip_slug, gcs_deleted_at }) => ({ clip_id, player_slug, clip_slug, gcs_deleted_at: gcs_deleted_at === undefined ? DONE : gcs_deleted_at }));
    },
    async markPurged(clipId: string) {
      const row = rows.find((r) => r.clip_id === clipId)!;
      row.local_purged_at = new Date().toISOString();
      stamps.push(clipId);
    },
  };
}

function tempFrames(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "purge-frames-"));
}

test("purge removes frames/<player>/<clipSlug>/ for unpurged deletions, stamps them, and is a no-op on re-run", async () => {
  const root = tempFrames();
  const doomed = path.join(root, "emily-c", "Emily_C_AB1 (4)-1727000000000");
  const keep = path.join(root, "emily-c", "other-clip");
  fs.mkdirSync(path.join(doomed, "phase_stills"), { recursive: true });
  fs.writeFileSync(path.join(doomed, "phase_stills", "analysis_result_x.json"), "{}");
  fs.writeFileSync(path.join(doomed, "pose_3d.json"), "{}");
  fs.mkdirSync(keep, { recursive: true });

  const db = fakeDb([
    { clip_id: "a", player_slug: "emily-c", clip_slug: "Emily_C_AB1 (4)-1727000000000", local_purged_at: null },
    { clip_id: "b", player_slug: "emily-c", clip_slug: "never-processed", local_purged_at: null }, // no local dir: still stamped
    { clip_id: "c", player_slug: "emily-c", clip_slug: "other-clip", local_purged_at: "2026-10-01T00:00:00Z" }, // already purged
  ]);

  assert.equal(await purgeDeletedClips(db, root), 2);
  assert.equal(fs.existsSync(doomed), false, "the deleted clip's derived files are gone");
  assert.equal(fs.existsSync(keep), true, "other clips' directories are untouched");
  assert.equal(fs.existsSync(path.join(root, "emily-c")), true, "the player directory itself stays");
  assert.deepEqual(db.stamps.sort(), ["a", "b"]);

  assert.equal(await purgeDeletedClips(db, root), 0, "second run finds nothing to do");
  assert.deepEqual(db.stamps.sort(), ["a", "b"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("purge refuses unsafe slugs (never deletes outside frames/<player>/<clip>) and leaves them unstamped", async () => {
  const root = tempFrames();
  const outside = path.join(root, "..", `purge-outside-${Date.now()}`);
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(root, "p"), { recursive: true });
  const db = fakeDb([
    { clip_id: "t1", player_slug: "..", clip_slug: path.basename(outside), local_purged_at: null },
    { clip_id: "t2", player_slug: "p", clip_slug: "..", local_purged_at: null },
    { clip_id: "t3", player_slug: "p", clip_slug: "", local_purged_at: null },
    { clip_id: "t4", player_slug: "p", clip_slug: "a/b", local_purged_at: null },
    { clip_id: "t5", player_slug: "p", clip_slug: "a\\b", local_purged_at: null },
  ]);
  assert.equal(await purgeDeletedClips(db, root), 0);
  assert.equal(fs.existsSync(outside), true);
  assert.equal(fs.existsSync(path.join(root, "p")), true);
  assert.deepEqual(db.stamps, []);
  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("purge skips a deletion that never finished (gcs_deleted_at null: the clip row still exists, a retry is pending)", async () => {
  const root = tempFrames();
  const unfinished = path.join(root, "p", "half-deleted");
  fs.mkdirSync(unfinished, { recursive: true });
  const db = fakeDb([{ clip_id: "u", player_slug: "p", clip_slug: "half-deleted", local_purged_at: null, gcs_deleted_at: null }]);
  assert.equal(await purgeDeletedClips(db, root), 0);
  assert.equal(fs.existsSync(unfinished), true, "local files kept until the deletion finishes");
  assert.deepEqual(db.stamps, []);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- Retry of deletions that failed part-way (retryUnfinishedDeletions).

const BUCKET = "hl-test";
const NOW = new Date("2026-10-02T12:00:00Z");

interface StuckRow { clip_id: string; player_slug: string; clip_slug?: string | null; game_log_entry_id?: string | null; raw_gcs_path: string | null; requested_at: string; gcs_deleted_at: string | null }

/** In-memory clip_deletions + the finish_clip_deletion side effect (stamps gcs_deleted_at, idempotent). */
function fakeRetryDb(rows: StuckRow[], failFinish = new Set<string>()) {
  const finished: string[] = [];
  const db: RetryDb = {
    async staleUnfinished(before) {
      return rows.filter((r) => r.gcs_deleted_at === null && new Date(r.requested_at) < before)
        .map(({ clip_id, player_slug, clip_slug, game_log_entry_id, raw_gcs_path }) => ({ clip_id, player_slug, clip_slug: clip_slug ?? null, game_log_entry_id: game_log_entry_id ?? null, raw_gcs_path }));
    },
    async finishDeletion(clipId) {
      if (failFinish.has(clipId)) throw new Error("finish failed");
      const row = rows.find((r) => r.clip_id === clipId)!;
      row.gcs_deleted_at ??= NOW.toISOString();
      finished.push(clipId);
    },
  };
  return { db, finished };
}

test("retry finishes deletions stuck for more than 15 minutes (storage delete, then finish), and only those", async () => {
  const old = new Date(NOW.getTime() - UNFINISHED_RETRY_AFTER_MS - 60_000).toISOString();
  const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  const rows: StuckRow[] = [
    { clip_id: "stuck", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/a.mp4`, requested_at: old, gcs_deleted_at: null },
    { clip_id: "no-object", player_slug: "emily", raw_gcs_path: null, requested_at: old, gcs_deleted_at: null },
    { clip_id: "recent", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/b.mp4`, requested_at: recent, gcs_deleted_at: null },
    { clip_id: "done", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/c.mp4`, requested_at: old, gcs_deleted_at: old },
  ];
  const { db, finished } = fakeRetryDb(rows);
  const deleted: string[] = [];
  const order: string[] = [];
  const del = async (p: string) => { deleted.push(p); order.push(`delete:${p}`); };
  const wrapped: RetryDb = { ...db, finishDeletion: async (id) => { order.push(`finish:${id}`); await db.finishDeletion(id); } };

  assert.equal(await retryUnfinishedDeletions(wrapped, del, BUCKET, NOW), 2);
  assert.deepEqual(deleted, [`gs://${BUCKET}/team/emily/raw/a.mp4`]);
  assert.deepEqual(finished.sort(), ["no-object", "stuck"]);
  assert.ok(order.indexOf(`delete:gs://${BUCKET}/team/emily/raw/a.mp4`) < order.indexOf("finish:stuck"), "storage before finish");
  assert.equal(rows.find((r) => r.clip_id === "recent")!.gcs_deleted_at, null, "a recent one is left for the user's own retry");

  // Idempotent: a second loop finds nothing to do.
  assert.equal(await retryUnfinishedDeletions(wrapped, del, BUCKET, NOW), 0);
  assert.equal(deleted.length, 1);
});

test("retry never deletes an object outside this bucket's <team>/<player>/raw/ and keeps going after a failure", async () => {
  const old = new Date(NOW.getTime() - UNFINISHED_RETRY_AFTER_MS - 1).toISOString();
  const rows: StuckRow[] = [
    { clip_id: "other-bucket", player_slug: "emily", raw_gcs_path: "gs://elsewhere/team/emily/raw/a.mp4", requested_at: old, gcs_deleted_at: null },
    { clip_id: "other-player", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/sara/raw/a.mp4`, requested_at: old, gcs_deleted_at: null },
    { clip_id: "traversal", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/../../x.mp4`, requested_at: old, gcs_deleted_at: null },
    { clip_id: "nested", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/sub/a.mp4`, requested_at: old, gcs_deleted_at: null },
    { clip_id: "storage-fails", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/fail.mp4`, requested_at: old, gcs_deleted_at: null },
    { clip_id: "finish-fails", player_slug: "emily", raw_gcs_path: null, requested_at: old, gcs_deleted_at: null },
    { clip_id: "ok", player_slug: "emily", raw_gcs_path: `gs://${BUCKET}/team/emily/raw/ok.mp4`, requested_at: old, gcs_deleted_at: null },
  ];
  const { db, finished } = fakeRetryDb(rows, new Set(["finish-fails"]));
  const deleted: string[] = [];
  const del = async (p: string) => { if (p.endsWith("fail.mp4")) throw new Error("storage down"); deleted.push(p); };
  assert.equal(await retryUnfinishedDeletions(db, del, BUCKET, NOW), 1);
  assert.deepEqual(deleted, [`gs://${BUCKET}/team/emily/raw/ok.mp4`]);
  assert.deepEqual(finished, ["ok"]);
  for (const id of ["other-bucket", "other-player", "traversal", "nested", "storage-fails", "finish-fails"]) {
    assert.equal(rows.find((r) => r.clip_id === id)!.gcs_deleted_at, null, `${id} stays unfinished`);
  }
});

test("isOwnRawObject: exactly gs://<bucket>/<team>/<player>/raw/<file>", () => {
  assert.equal(isOwnRawObject(`gs://${BUCKET}/t/p/raw/f.mp4`, BUCKET, "p"), true);
  assert.equal(isOwnRawObject(`gs://${BUCKET}/t/p/raw/f.mp4`, "", "p"), false);
  assert.equal(isOwnRawObject(`gs://${BUCKET}/t/q/raw/f.mp4`, BUCKET, "p"), false);
  assert.equal(isOwnRawObject(`gs://${BUCKET}/t/p/frames/f.mp4`, BUCKET, "p"), false);
  assert.equal(isOwnRawObject(`gs://${BUCKET}/t/p/raw/`, BUCKET, "p"), false);
  assert.equal(isOwnRawObject(`gs://${BUCKET}/../p/raw/f.mp4`, BUCKET, "p"), false);
  assert.equal(isOwnRawObject(`gs://${BUCKET}x/t/p/raw/f.mp4`, BUCKET, "p"), false);
});

test("retry accepts only an opaque object belonging to the audited entry and clip", async () => {
  const entry = "11111111-1111-4111-8111-111111111111";
  const clip = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const old = new Date(NOW.getTime() - UNFINISHED_RETRY_AFTER_MS - 1).toISOString();
  const pathFor = (id: string) => `gs://${BUCKET}/${entry}/raw/${id}.mp4`;
  const { db, finished } = fakeRetryDb([
    { clip_id: clip, clip_slug: clip, game_log_entry_id: entry, player_slug: "emily", raw_gcs_path: pathFor(clip), requested_at: old, gcs_deleted_at: null },
    { clip_id: other, clip_slug: other, game_log_entry_id: entry, player_slug: "emily", raw_gcs_path: pathFor(clip), requested_at: old, gcs_deleted_at: null },
  ]);
  const deleted: string[] = [];
  assert.equal(await retryUnfinishedDeletions(db, async (path) => { deleted.push(path); }, BUCKET, NOW), 1);
  assert.deepEqual(deleted, [pathFor(clip)]);
  assert.deepEqual(finished, [clip]);
});
