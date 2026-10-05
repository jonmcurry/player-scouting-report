export const MAX_UPLOAD_SECONDS = 3 * 60;

/** Return a terminal user-safe reason, or null when processing may continue. */
export function uploadDurationRejection(durationSeconds: number): string | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Couldn't read the uploaded video's duration.");
  }
  return durationSeconds > MAX_UPLOAD_SECONDS
    ? "This video is longer than the 3-minute upload limit."
    : null;
}
