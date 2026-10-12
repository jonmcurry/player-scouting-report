import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { checkMigrationVersions } from './check-migration-versions.mjs';
test('repository migration versions are unique', () => assert.ok(checkMigrationVersions(readdirSync(new URL('../supabase/migrations/', import.meta.url))) >= 64));
test('duplicate versions including different zero padding fail', () => {
  for (const duplicate of ['00062_drills.sql', '62_drills.sql']) {
    assert.throws(() => checkMigrationVersions(['00062_progress.sql', duplicate]), /Duplicate/);
  }
});
test('ordered unique versions pass; malformed and empty histories fail', () => {
  assert.equal(checkMigrationVersions(['00063_drills.sql', '00062_progress.sql', 'README.md']), 2);
  assert.throws(() => checkMigrationVersions(['bad.sql']), /Invalid/);
  assert.throws(() => checkMigrationVersions([]), /No SQL/);
});
