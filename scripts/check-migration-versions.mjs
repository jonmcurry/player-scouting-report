import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkMigrationVersions(names) {
  const seen = new Map();
  for (const name of names.filter(name => name.endsWith('.sql')).sort()) {
    const match = /^(\d+)_[a-zA-Z0-9_]+\.sql$/.exec(name);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);
    const version = BigInt(match[1]).toString();
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version}: ${seen.get(version)}, ${name}`);
    seen.set(version, name);
  }
  if (!seen.size) throw new Error('No SQL migrations found');
  return seen.size;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`Migration versions unique: ${checkMigrationVersions(readdirSync(new URL('../supabase/migrations/', import.meta.url)))}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
