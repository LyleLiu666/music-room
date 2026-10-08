import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/music/score.ts';
import { compose } from '../src/songs/rain-letter-v1.ts';
import { encodeWav } from '../src/wav.ts';

test('a complete 180 second score has contiguous, contrasting sections', () => {
  const score = compose();
  assert.equal(score.duration, 180);
  assert.equal(score.bpm, 96);
  assert.equal(score.bars.length, 72);
  assert.equal(score.sections.length, 7);
  let end = 0;
  for (const section of score.sections) {
    assert.equal(section.startBar, end);
    end += section.bars;
    assert.ok(score.notes.some(n => n.beat >= section.startBar * 4 && n.beat < end * 4));
  }
  assert.equal(end, 72);
  const density = (a: number, b: number) => score.notes.filter(n => n.beat >= a * 4 && n.beat < b * 4).length / (b - a);
  assert.ok(density(32, 48) > density(0, 8) * 1.6, 'chorus must actually develop the arrangement');
  assert.ok(density(68, 72) < density(56, 68), 'outro resolves with a thinner arrangement');
});

test('all performances are valid, reproducible and leave space for the final decay', () => {
  const a = compose();
  assert.deepEqual(a, compose());
  assert.ok(a.notes.length > 2500);
  for (const n of a.notes) {
    assert.ok(TRACKS.some(t => t.id === n.track));
    assert.ok(Number.isFinite(n.beat) && n.beat >= 0);
    assert.ok(n.duration > 0 && (n.beat + n.duration) * 60 / a.bpm < a.duration);
    assert.ok(Number.isInteger(n.pitch) && n.pitch >= 24 && n.pitch <= 100);
    assert.ok(n.velocity > 0 && n.velocity <= 1);
  }
  assert.equal(a.bars.at(-1)?.chord, 'Dm(add9)');
});

test('a repeated chorus retains its theme but changes its performance', () => {
  const score = compose();
  const first = score.notes.filter(n => n.track === 'melody' && n.beat >= 128 && n.beat < 176);
  const final = score.notes.filter(n => n.track === 'melody' && n.beat >= 224 && n.beat < 272);
  assert.ok(first.length > 45 && final.length > 45);
  assert.ok(first.some((n, i) => final[i] && n.velocity !== final[i].velocity));
  assert.ok(new Set(score.bars.map(b => b.chord)).size >= 14, 'harmonic development, not a four-chord loop');
});

test('WAV export encodes stereo PCM, duration and clipped inputs safely', () => {
  const data = encodeWav([new Float32Array([0, 1.2, -1.2]), new Float32Array([0.5, -0.5, 0])], 44100);
  const view = new DataView(data);
  assert.equal(new TextDecoder().decode(new Uint8Array(data, 0, 4)), 'RIFF');
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getInt16(48, true), 32767);
  assert.equal(view.getInt16(52, true), -32768);
});
