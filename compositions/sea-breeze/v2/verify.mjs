import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const current = await read('./song.json');
const previous = await read('../v1/song.json');
const events = (doc, track) => doc.score.notes.filter(n => n.track === track);
const attacks = (doc, track) => new Set(events(doc, track).map(n => n.beat)).size;
const meanDuration = (doc, track) => events(doc, track).reduce((s, n) => s + n.duration, 0) / events(doc, track).length;

test('same work and comparable eight-bar theme, with a new revision', () => {
  assert.deepEqual(current.work, previous.work);
  assert.notEqual(current.revision.id, previous.revision.id);
  assert.notEqual(current.revision.label, previous.revision.label);
  assert.equal(current.format, 'music-room-score');
  assert.equal(current.version, 1);
  assert.equal(current.score.bpm, 96);
  assert.equal(current.score.bars.length, 8);
  assert.equal(current.score.duration, 20);
  assert.deepEqual(current.comparisonSections, previous.comparisonSections);
  assert.equal(current.score.sections[0].bars, 8);
});

test('more frequent, shorter piano and bass pulses than v1', () => {
  assert.ok(attacks(current, 'piano') >= attacks(previous, 'piano') * 1.3);
  assert.ok(attacks(current, 'bass') >= attacks(previous, 'bass') * 1.25);
  assert.ok(meanDuration(current, 'piano') < meanDuration(previous, 'piano') * 0.65);
  assert.ok(meanDuration(current, 'bass') < meanDuration(previous, 'bass') * 0.65);
  for (let bar = 0; bar < 7; bar++) {
    const hats = events(current, 'hat').filter(n => n.beat >= bar * 4 && n.beat < bar * 4 + 4);
    assert.equal(hats.length, 8, `Bar ${bar + 1} maintains eighth-note pulse`);
    hats.forEach((n, i) => assert.ok(Math.abs(n.beat - (bar * 4 + i * 0.5)) < 0.03));
  }
});

test('two-bar riff returns with a changed crest; answers and long ending remain', () => {
  const melody = events(current, 'melody').sort((a, b) => a.beat - b.beat);
  const riff = melody.filter(n => n.beat < 8);
  const returned = melody.filter(n => n.beat >= 16 && n.beat < 24);
  assert.ok(riff.length >= 6 && riff.length <= 9);
  assert.deepEqual(returned.map(n => n.beat - 16), riff.map(n => n.beat));
  assert.ok(Math.max(...returned.map(n => n.pitch)) > Math.max(...riff.map(n => n.pitch)));
  const answer = melody.filter(n => n.beat >= 8 && n.beat < 16);
  assert.ok(answer.at(-1).pitch < answer[0].pitch);
  assert.equal(melody.at(-1).pitch, 74);
  assert.ok(melody.at(-1).duration >= 2);
  assert.ok(melody.every(n => n.duration >= 0.35));
  for (let start = 0; start < 32; start += 8) {
    const sounding = melody.filter(n => n.beat >= start && n.beat < start + 8).reduce((s, n) => s + n.duration, 0);
    assert.ok(8 - sounding >= 1, 'Each phrase still breathes');
  }
  melody.slice(1).forEach((n, i) => assert.ok(melody[i].beat + melody[i].duration <= n.beat + 1e-8));
});

test('no same-note overlaps, no unexpected tracks, and a half-beat ending space', () => {
  const allowed = new Set(['melody', 'piano', 'bass', 'kick', 'snare', 'hat']);
  const ends = new Map();
  for (const n of [...current.score.notes].sort((a, b) => a.beat - b.beat)) {
    assert.ok(allowed.has(n.track));
    assert.ok(n.beat >= 0 && n.beat + n.duration <= 31.5 + 1e-8);
    const key = `${n.track}:${n.pitch}`;
    assert.ok((ends.get(key) ?? 0) <= n.beat + 1e-8, `Overlapping retrigger: ${key}`);
    ends.set(key, n.beat + n.duration);
    if (['kick', 'snare', 'hat'].includes(n.track)) assert.ok(n.velocity <= 0.65);
  }
});
