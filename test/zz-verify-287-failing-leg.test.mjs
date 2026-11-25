// DO NOT MERGE — panelist#287 verification fixture.
// Fails ONLY on the Node 24 matrix leg, so the run proves that a single red
// leg turns the aggregate "CI Required" job red and blocks the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('deliberately failing matrix leg (panelist#287)', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.notEqual(major, 24, 'deliberate failure on the Node 24 leg');
});
