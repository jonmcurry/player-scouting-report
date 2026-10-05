const VIDEO_UPLOAD_TYPES = Object.freeze({
  ".mp4": Object.freeze(["video/mp4"]),
  ".m4v": Object.freeze(["video/mp4", "video/x-m4v"]),
  ".mov": Object.freeze(["video/quicktime"]),
  ".webm": Object.freeze(["video/webm"]),
});

/**
 * Return the normalized extension and signed Content-Type for a supported
 * browser upload. Some phone pickers omit MIME metadata, so a known extension
 * may supply its canonical type. A conflicting declared type fails closed.
 */
export function acceptedVideoUpload(extension, declaredType = "") {
  const normalizedExtension = String(extension ?? "").toLowerCase();
  const allowed = VIDEO_UPLOAD_TYPES[normalizedExtension];
  if (!allowed) return null;
  const normalizedType = String(declaredType ?? "").trim().toLowerCase();
  if (normalizedType && !allowed.includes(normalizedType)) return null;
  return { extension: normalizedExtension, contentType: normalizedType || allowed[0] };
}

export const VIDEO_UPLOAD_HELP = "Choose an MP4, M4V, MOV, or WebM video.";
