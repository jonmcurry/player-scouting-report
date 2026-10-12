import test from 'node:test';
import assert from 'node:assert/strict';
import { shapePlayerReport } from '../functions/get-player-report/shape.ts';

test('family and demo report shaping only includes approved assigned drills', () => {
  const report = shapePlayerReport({
    player: { name: 'Test', jersey_number: null, teamName: 'Test' }, scores: [], observations: [], loggedAtBats: 0,
    priorities: [{ id: 'p', title: 'Focus', description: '', status: 'active', priority_order: 0, first_identified_at: '', resolved_at: null }],
    drills: ['approved', 'draft', 'rejected', null, undefined].map(curation_status => ({
      player_priority_id: 'p', active: true, coach_note: '',
      drill_library: { name: String(curation_status), purpose: '', instructions: '', equipment: '', curation_status },
    })),
  });
  assert.deepEqual(report.priorities[0]!.drills.map(d => d.name), ['approved']);
});
