import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SONGS, WORKS, songById, versionsOf, validateCatalog } from '../src/catalog.ts';

test('work grouping uses stable identity and supports different tempos and lengths', () => {
  assert.equal(WORKS.length, 1);
  assert.equal(versionsOf(WORKS[0].id).length, 2);
  const short = { ...SONGS[0], id: 'other-v1', workId: 'other', title: SONGS[0].title,
    files: { wav: 'other.wav', midi: 'other.mid', score: 'other.json' },
    comparisonSections: {}, compose: () => ({ ...SONGS[0].compose(), bpm: 120, duration: 4 }) };
  const works = [...WORKS, { id: 'other', title: SONGS[0].title, defaultVersionId: short.id }];
  assert.doesNotThrow(() => validateCatalog(works, [...SONGS, short]));
  assert.deepEqual(versionsOf('other', [...SONGS, short]).map(s => s.id), ['other-v1']);
  assert.throws(() => validateCatalog(works, [...SONGS, { ...short, workId: 'missing' }]));
  assert.throws(() => validateCatalog(WORKS, [...SONGS, { ...SONGS[0] }]));
  assert.throws(() => validateCatalog(WORKS, [SONGS[0], { ...SONGS[1], files: SONGS[0].files }]));
  assert.throws(() => validateCatalog([{ ...WORKS[0], defaultVersionId: 'missing' }], SONGS));
  assert.throws(() => validateCatalog(WORKS, [{ ...SONGS[0], comparisonSections: { theme: 99 } }, SONGS[1]]));
});

test('each song has its own identity, score and export paths', () => {
  assert.ok(SONGS.length >= 2);
  assert.equal(new Set(SONGS.map(s => s.id)).size, SONGS.length);
  assert.equal(new Set(SONGS.map(s => s.files.wav)).size, SONGS.length);
  for (const song of SONGS) {
    assert.equal(songById(song.id), song);
    assert.ok(song.files.wav.includes(song.id));
    assert.ok(song.files.midi.includes(song.id));
    assert.ok(song.files.score.includes(song.id));
    const score = song.compose();
    assert.equal(score.duration, 180);
    assert.ok(score.notes.length);
  }
  assert.equal(songById('unknown-song'), undefined);
  assert.notDeepEqual(SONGS[0].compose().notes, SONGS[1].compose().notes);
});

test('the first composition remains unchanged as the first edition', () => {
  const score = songById('rain-letter-v1')!.compose();
  assert.equal(score.notes.length, 3709);
  assert.equal(score.notes.filter(n => n.track === 'melody').length, 414);
  assert.deepEqual(score, JSON.parse(readFileSync(new URL('../public/exports/rain-letter.score.json', import.meta.url), 'utf8')));
});

test('the second edition has a recognizable riff, breathing room and developed answers', () => {
  const score = songById('rain-letter-v2')!.compose();
  const melody = score.notes.filter(n => n.track === 'melody');
  const phrase = (bar: number) => melody.filter(n => {
    const writtenBeat = Math.round(n.beat * 4) / 4;
    return writtenBeat >= bar * 4 && writtenBeat < bar * 4 + 8;
  });
  const opening = phrase(0);
  const returnAt = phrase(8);
  assert.ok(opening.length >= 7 && opening.length <= 10);
  assert.deepEqual(opening.map(n => n.pitch), returnAt.map(n => n.pitch), 'riff identity returns in the verse');
  assert.ok(melody.length < 300, 'the lead should have room rather than run constantly');
  assert.ok(melody.filter(n => n.duration >= 1.6).length >= 20, 'sustained melody endings');
  const gaps = melody.slice(1).filter((n, i) => n.beat - (melody[i].beat + melody[i].duration) >= .45);
  assert.ok(gaps.length >= 15, 'audible breaths between phrases');
  const firstQuestion = phrase(32), secondQuestion = phrase(36);
  assert.deepEqual(firstQuestion.map(n => n.pitch), secondQuestion.map(n => n.pitch), 'a stable chorus refrain');
  const firstAnswer = phrase(34), secondAnswer = phrase(38);
  assert.notDeepEqual(firstAnswer.map(n => n.pitch), secondAnswer.map(n => n.pitch), 'different answers prevent mechanical looping');
  assert.ok(!score.notes.some(n => n.track === 'melody' && n.beat >= 192 && n.beat < 208), 'the bridge leaves the lead piano out briefly');
});
