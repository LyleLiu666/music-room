import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Tests guard the listening brief; musical quality still needs human listening.
const doc = JSON.parse(await readFile(new URL('./song.json', import.meta.url), 'utf8'));
const { score } = doc;
const melody = score.notes.filter(n => n.track === 'melody').sort((a, b) => a.beat - b.beat);

test('eight bars at 96 BPM, implicit 4/4, exactly twenty seconds', () => {
  assert.equal(doc.format, 'music-room-score');
  assert.equal(doc.version, 1);
  assert.equal(score.bpm, 96);
  assert.equal(score.bars.length, 8);
  assert.equal(score.duration, 20);
  assert.equal(score.duration, 8 * 4 * 60 / score.bpm);
  assert.equal(score.sections.length, 1);
  assert.equal(score.sections[0].bars, 8);
  assert.deepEqual(doc.comparisonSections, { theme: 0 });
});

test('new work and revision have distinct valid identities', () => {
  assert.match(doc.work.id, /^[a-z][a-z0-9-]{0,63}$/);
  assert.match(doc.revision.id, /^[a-z][a-z0-9-]{0,63}$/);
  assert.notEqual(doc.work.id, doc.revision.id);
  assert.equal(doc.work.title, score.title);
  assert.ok(doc.revision.label.length > 0);
});

test('theme has a two-bar contour, an answer, a varied return and tonic ending', () => {
  const phrase = start => melody.filter(n => n.beat >= start && n.beat < start + 8);
  const riff = phrase(0);
  const answer = phrase(8);
  const returned = phrase(16);
  assert.equal(riff.length, 6);
  assert.deepEqual(riff.slice(1).map((n, i) => n.pitch - riff[i].pitch), [3, 7, -2, -5, -3]);
  assert.equal(answer.length, 6);
  assert.ok(answer.at(-1).pitch < answer[0].pitch);
  assert.deepEqual(returned.map(n => n.beat - 16), riff.map(n => n.beat));
  assert.notDeepEqual(returned.map(n => n.pitch), riff.map(n => n.pitch));
  assert.equal(melody.at(-1).pitch, 74); // D5: final tonic.
  assert.ok(melody.at(-1).duration >= 2.5);
});

test('singable monophonic melody, with space in every two-bar phrase', () => {
  assert.ok(melody.length <= 26);
  assert.ok(melody.every(n => n.duration >= 0.4));
  for (let i = 1; i < melody.length; i++) {
    assert.ok(melody[i - 1].beat + melody[i - 1].duration <= melody[i].beat + 1e-8);
  }
  for (let start = 0; start < 32; start += 8) {
    const sounding = melody.filter(n => n.beat >= start && n.beat < start + 8)
      .reduce((sum, n) => sum + n.duration, 0);
    assert.ok(8 - sounding >= 1.5, `Phrase at beat ${start} needs breathing room`);
  }
});

test('piano leads; restrained drums and no colliding retriggers or notes beyond the end', () => {
  const allowed = new Set(['melody', 'piano', 'bass', 'kick', 'snare', 'hat']);
  const drums = new Set(['kick', 'snare', 'hat']);
  const ends = new Map();
  for (const n of [...score.notes].sort((a, b) => a.beat - b.beat)) {
    assert.ok(allowed.has(n.track));
    assert.ok(n.beat + n.duration <= 31.25 + 1e-8); // Last .75 beat is a release space.
    if (drums.has(n.track)) assert.ok(n.velocity <= 0.55);
    const key = `${n.track}:${n.pitch}`;
    assert.ok((ends.get(key) ?? 0) <= n.beat + 1e-8, `Overlapping retrigger ${key}`);
    ends.set(key, n.beat + n.duration);
  }
  assert.ok(score.notes.some(n => n.track === 'piano'));
  assert.ok(score.notes.some(n => n.track === 'bass'));
  assert.ok(Math.max(...melody.map(n => n.velocity)) > Math.max(...score.notes.filter(n => n.track === 'piano').map(n => n.velocity)));
});
