import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAnnotation, validateAnnotation, SCHEMA_VERSION, type ClipAnnotation } from '../schema/annotation.ts';
import { sha256, type RegistryClip } from './registry.ts';

export type AnnotationResult = { ok: false; code: string; sha256: string | null } | {
  ok: true; annotation: ClipAnnotation; identity: {
    schema_version: string; eval_clip_id: string; revision: number; review_status: string;
    data_origin: string; sha256: string; annotation_basis: 'adjudicated' | 'single_annotator';
  };
};
export async function loadAnnotation(root: string, clip: RegistryClip): Promise<AnnotationResult> {
  const dir = join(root, 'annotations', SCHEMA_VERSION, clip.eval_id);
  let names: string[];
  try { names = (await readdir(dir)).filter(n => n.endsWith('.json')); }
  catch (e) { return { ok: false, code: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'annotation_missing' : 'annotation_invalid', sha256: null }; }
  const adjudicated = names.includes('adjudicated.json');
  if (!adjudicated && names.length !== 1) return { ok: false, code: names.length ? 'annotation_unadjudicated' : 'annotation_missing', sha256: null };
  const name = adjudicated ? 'adjudicated.json' : names[0]!;
  if (!adjudicated && !/^ann_[a-f0-9]{16}\.json$/.test(name)) return { ok: false, code: 'annotation_invalid', sha256: null };
  let digest: string | null = null;
  try {
    if (!(await lstat(join(dir, name))).isFile() || (await lstat(join(dir, name))).isSymbolicLink()) return { ok: false, code: 'annotation_invalid', sha256: null };
    const bytes = await readFile(join(dir, name)); digest = sha256(bytes);
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.schema_version !== SCHEMA_VERSION) return { ok: false, code: 'UNSUPPORTED_ANNOTATION_SCHEMA', sha256: digest };
    if (!validateAnnotation(value).valid) return { ok: false, code: 'annotation_invalid', sha256: digest };
    const annotation = parseAnnotation(value);
    if (annotation.eval_clip_id !== clip.eval_id) return { ok: false, code: 'annotation_clip_mismatch', sha256: digest };
    if (annotation.source.sha256 !== clip.sha256) return { ok: false, code: 'source_hash_mismatch', sha256: digest };
    return { ok: true, annotation, identity: { schema_version: annotation.schema_version, eval_clip_id: annotation.eval_clip_id,
      revision: annotation.annotation.revision, review_status: annotation.annotation.review.status,
      data_origin: annotation.data_origin, sha256: digest, annotation_basis: adjudicated ? 'adjudicated' : 'single_annotator' } };
  } catch { return { ok: false, code: 'annotation_invalid', sha256: digest }; }
}
