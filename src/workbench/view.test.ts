import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowAt, beatAtSeconds, secondsAtBeat, notesInRange, pitchExtent } from './view.ts';
import { compose } from '../songs/rain-letter-v2.ts';

test('local windows show actual remaining bars without changing the score', () => {
  const score = compose(), original = structuredClone(score);
  assert.deepEqual(windowAt(score, 8, 4), { startBar: 8, endBar: 12, startBeat: 32, endBeat: 48 });
  assert.deepEqual(windowAt(score, 70, 4), { startBar: 70, endBar: 72, startBeat: 280, endBeat: 288 });
  assert.equal(windowAt(score, -4, 8).startBar, 0);
  assert.equal(windowAt(score, 90, 4).startBar, 71);
  assert.deepEqual(score, original);
});

test('time conversion depends on each score tempo and not three minute duration', () => {
  assert.equal(beatAtSeconds(12, 120), 24);
  assert.equal(secondsAtBeat(24, 120), 12);
  assert.equal(secondsAtBeat(24, 96), 15);
});

test('local view includes notes sustained from before its left edge', () => {
  const notes = [
    { track: 'melody' as const, pitch: 60, beat: 0, duration: 6, velocity: .5 },
    { track: 'melody' as const, pitch: 90, beat: 8, duration: 1, velocity: .5 },
  ];
  assert.deepEqual(notesInRange(notes, 4, 8), [notes[0]]);
  assert.deepEqual(pitchExtent(notes), { low: 60, high: 90 });
  assert.deepEqual(pitchExtent([]), { low: 60, high: 72 });
});
