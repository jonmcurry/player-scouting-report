/**
 * GCS helper for downloading a browser-uploaded raw clip so the pose3d
 * pipeline (which needs a real local file, not a GCS path) can process it.
 * Browser->GCS upload itself is signed independently, Deno-side, inside the
 * get-upload-url Edge Function (a separate runtime that can't import this
 * Node module) - this file no longer generates any signed URLs itself; the
 * coach app's video PLAYBACK path (which used to need a signed read URL
 * here too) was replaced by the 3D skeleton comparison, which fetches real
 * pose3d data straight from Supabase instead (see the approved plan).
 *
 * Local dev: set GCS_EMULATOR_HOST (see .env.example, docker-compose.yml's
 * gcs-emulator service) and this points the official @google-cloud/storage
 * client at fake-gcs-server - downloads work identically to real GCS, no
 * real credentials needed.
 *
 * Emulator wiring is trickier than the client's own docs suggest: setting
 * only STORAGE_EMULATOR_HOST (with the required /storage/v1 suffix, per the
 * client's own source) makes bucket/metadata calls work, but the SAME env
 * var also becomes the base for the *upload* endpoint construction, which
 * then double-prepends "/storage/v1" and 404s. The fix (confirmed by
 * reading @google-cloud/storage's own source, not guessed): also pass a
 * bare `apiEndpoint` constructor option (no path suffix) - the two settings
 * feed two different internal path-building code paths that need different
 * values to both come out correct.
 */
import { Storage } from "@google-cloud/storage";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

function getStorageClient(): Storage {
  const emulatorHost = process.env.GCS_EMULATOR_HOST;
  if (emulatorHost) {
    process.env.STORAGE_EMULATOR_HOST = `${emulatorHost}/storage/v1`;
    return new Storage({ projectId: process.env.GCP_PROJECT_ID, apiEndpoint: emulatorHost });
  }
  return new Storage({ projectId: process.env.GCP_PROJECT_ID });
}

function getBucketName(): string {
  const bucket = process.env.GCS_BUCKET_NAME;
  if (!bucket) throw new Error("GCS_BUCKET_NAME must be set (see .env.example).");
  return bucket;
}

/** Shared `gs://bucket/object` parser, used by downloadFile. */
function parseGcsPath(gcsPath: string): { bucketName: string; objectPath: string } {
  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Not a valid gs:// path: ${gcsPath}`);
  return { bucketName: match[1]!, objectPath: match[2]! };
}

/** Ensures the configured bucket exists - only meaningful/needed against the
 * local emulator (a real GCS bucket should already exist, created once via
 * `gsutil mb` or Terraform, not auto-created by application code). */
export async function ensureBucketExists(): Promise<void> {
  const storage = getStorageClient();
  const bucket = storage.bucket(getBucketName());
  const [exists] = await bucket.exists();
  if (!exists) {
    await storage.createBucket(getBucketName());
  }
}

/** Downloads a gs:// object to a local file path - the worker's own need:
 * the pose3d Python pipeline requires a real local file, not a GCS path, so
 * a browser-uploaded raw clip must be pulled down before it can be
 * processed. Creates the destination's parent directory if missing. */
export async function downloadFile(gcsPath: string, localDestPath: string): Promise<void> {
  const { bucketName, objectPath } = parseGcsPath(gcsPath);
  const storage = getStorageClient();
  await fs.promises.mkdir(path.dirname(localDestPath), { recursive: true });
  await storage.bucket(bucketName).file(objectPath).download({ destination: localDestPath });
}

export interface RawUploadObject {
  gcsPath: string; // gs://bucket/object, same shape as video_clips.raw_gcs_path
  sizeBytes: number;
  updatedAt: string;
}

/** Lists every object under `<team>/<player>/raw/` anywhere in the bucket -
 * reconcileUploads.ts's own need: finding GCS objects with no matching
 * video_clips row (get-upload-url.ts writes the object, videoUpload.js's
 * follow-up INSERT is what would normally reference it - a dropped
 * connection between those two steps leaves bytes with nothing pointing at
 * them). Filters to the "raw/" segment specifically so this never touches
 * scripts/pose3d's local frames/ output or anything else this bucket might
 * one day hold - only the one path shape get-upload-url.ts ever writes to. */
export async function listRawUploadObjects(): Promise<RawUploadObject[]> {
  const bucketName = getBucketName();
  const storage = getStorageClient();
  const [files] = await storage.bucket(bucketName).getFiles();
  return files
    .filter((f) => f.name.includes("/raw/"))
    .map((f) => ({
      gcsPath: `gs://${bucketName}/${f.name}`,
      sizeBytes: Number(f.metadata.size ?? 0),
      updatedAt: f.metadata.updated ?? f.metadata.timeCreated ?? "",
    }));
}

/** Deletes one gs:// object - only ever called by reconcileUploads.ts's
 * explicit --delete-older-than-days opt-in, never automatically. */
export async function deleteObject(gcsPath: string): Promise<void> {
  const { bucketName, objectPath } = parseGcsPath(gcsPath);
  const storage = getStorageClient();
  await storage.bucket(bucketName).file(objectPath).delete();
}
