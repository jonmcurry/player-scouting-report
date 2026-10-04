// IndexedDB keeps selected videos on this device until both the GCS upload
// and video_clips registration succeed. Only IDs and the chosen result leave
// the device; the File is never placed in localStorage.
import { supabase } from "../shared.js";
import { uploadRawClip } from "./videoUpload.js";

const DB_NAME = "hitterloop-capture-v1";
const STORE = "captures";
let draining = false;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function database() {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
  return requestResult(request);
}

async function operation(mode, method, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = value === undefined ? tx.objectStore(STORE)[method]() : tx.objectStore(STORE)[method](value);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("Couldn't save this video on the device"));
      tx.onabort = () => reject(tx.error ?? new Error("Couldn't save this video on the device"));
    });
  } finally { db.close(); }
}

export async function queuedCaptures(userId) {
  const rows = await operation("readonly", "getAll");
  return rows.filter((row) => row.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function enqueueCapture({ userId, playerId, kind, result, file }) {
  if (!userId || !playerId || !["game", "practice"].includes(kind) || !(file instanceof File)) throw new Error("Invalid capture");
  const record = { id: crypto.randomUUID(), clipSlug: crypto.randomUUID(), userId, playerId,
    kind, result: result || null, file, createdAt: new Date().toISOString(), entryId: null,
    uploadedGcsPath: null, error: null };
  await operation("readwrite", "put", record);
  return record.id;
}

async function sendOne(record, asGuardian, onChange) {
  try {
    if (!record.entryId) {
      const { data: entryId, error } = await supabase.rpc("create_simple_at_bat", {
        p_player_id: record.playerId, p_kind: record.kind, p_result: record.result,
        p_date: record.createdAt.slice(0, 10), p_capture_id: record.id,
      });
      if (error || !entryId) throw new Error(error?.message ?? "Couldn't create at-bat");
      record.entryId = entryId;
      await operation("readwrite", "put", record);
    }
    const clipId = await uploadRawClip(record.entryId, record.file, {}, {
      asGuardian, clipSlug: record.clipSlug, uploadedGcsPath: record.uploadedGcsPath,
      onUploaded: async ({ gcsPath }) => {
        record.uploadedGcsPath = gcsPath;
        await operation("readwrite", "put", record);
      },
    });
    await operation("readwrite", "delete", record.id);
    onChange?.({ id: record.id, state: "sent", clipId });
  } catch (error) {
    record.error = error instanceof Error ? error.message : "Upload failed";
    await operation("readwrite", "put", record);
    onChange?.({ id: record.id, state: "retry", error: record.error });
  }
}

/** Safe to call on load, on online, and after a new selection. */
export async function drainCaptureQueue(userId, asGuardian, onChange) {
  if (draining || !navigator.onLine) return;
  draining = true;
  try {
    const run = async () => {
      for (const record of await queuedCaptures(userId)) {
        if (!navigator.onLine) break;
        onChange?.({ id: record.id, state: "uploading" });
        await sendOne(record, asGuardian, onChange);
      }
    };
    if (navigator.locks?.request) await navigator.locks.request(`hitterloop-capture-${userId}`, run);
    else await run();
  } finally { draining = false; }
}
