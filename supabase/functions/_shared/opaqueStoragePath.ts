const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the new entry-id/clip-id object layout is safe to expose in a signed URL. */
export function opaqueRawObject(
  rawPath: string | null,
  bucket: string,
  entryId: string,
  clipSlug: string,
  clipId?: string,
): string | null {
  if (!rawPath || !bucket || !UUID.test(entryId)) return null;
  for (const id of [clipSlug, clipId]) {
    if (!id || !UUID.test(id)) continue;
    const prefix = `gs://${bucket}/${entryId}/raw/${id}.`;
    if (!rawPath.startsWith(prefix)) continue;
    const ext = rawPath.slice(prefix.length);
    if (/^[A-Za-z0-9]{1,10}$/.test(ext)) return `${entryId}/raw/${id}.${ext}`;
  }
  return null;
}
