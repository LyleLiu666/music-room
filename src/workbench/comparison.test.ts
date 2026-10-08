import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonMapping } from './comparison.ts';
import { SONGS } from '../catalog.ts';

test('version mapping uses a common section and relative beats even when its absolute start differs', () => {
  const source = SONGS[0], target = SONGS[1];
  const a = source.compose(), b = target.compose();
  b.sections[1].startBar = 12;
  const result = comparisonMapping(source, target, a, b, 37.5, { startBeat: 32, endBeat: 48 });
  assert.deepEqual(result, { ok: true, beat: 53.5, range: { startBeat: 48, endBeat: 64 }, sectionId: 'theme', name: '主题 A' });
});

test('unmatched structure and cross-section selections are explained rather than silently clamped', () => {
  const source = SONGS[0], target = SONGS[1], a = source.compose(), b = target.compose();
  assert.equal(comparisonMapping(source, { ...target, workId: 'other' }, a, b, 35).ok, false);
  assert.equal(comparisonMapping(source, target, a, { ...b, bpm: 120 }, 35).ok, false);
  assert.equal(comparisonMapping(source, { ...target, comparisonSections: {} }, a, b, 35).ok, false);
  const short = structuredClone(b); short.sections[1].bars = 12;
  assert.equal(comparisonMapping(source, target, a, short, 35).ok, false);
  assert.equal(comparisonMapping(source, target, a, b, 35, { startBeat: 28, endBeat: 40 }).ok, false);
  assert.equal(comparisonMapping(source, target, a, b, 100, { startBeat: 32, endBeat: 48 }).ok, false);
  assert.equal(comparisonMapping(source, target, a, b, 288).ok, false);
});
