import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLoop, playbackPosition } from './playback.ts';
import { compose } from '../songs/rain-letter-v2.ts';

test('loops are nonempty whole-bar ranges inside the score', () => {
  const score = compose(), range = { startBeat: 32, endBeat: 48 };
  assert.deepEqual(validateLoop(range, score), range);
  for (const invalid of [{ startBeat: 4, endBeat: 4 }, { startBeat: -4, endBeat: 8 }, { startBeat: 0, endBeat: 300 }, { startBeat: 1, endBeat: 8 }, { startBeat: 0, endBeat: NaN }]) {
    assert.throws(() => validateLoop(invalid, score));
  }
});

test('audio clock wraps exactly and preserves a resumed position within the loop', () => {
  const loop = { start: 20, end: 25 };
  assert.equal(playbackPosition(21, 10, 9.98, 180, loop), 21);
  assert.equal(playbackPosition(21, 10, 13.5, 180, loop), 24.5);
  assert.equal(playbackPosition(21, 10, 14, 180, loop), 20);
  for (let i = 0; i < 20; i++) assert.equal(playbackPosition(20, 10, 10 + i * 5, 180, loop), 20);
  assert.equal(playbackPosition(170, 10, 30, 180), 180);
});
