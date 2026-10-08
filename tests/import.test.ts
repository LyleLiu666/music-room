import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateComposition, TRACK_IDS, MAX_FILE_BYTES } from '../src/music/authoring/validate.mjs';
import { TRACKS } from '../src/music/score.ts';
import { ImportedLibrary, STORAGE_KEY } from '../src/music/import/library.ts';
import { WORKS, SONGS } from '../src/catalog.ts';
const example = () => JSON.parse(readFileSync(new URL('../src/music/authoring/example.json', import.meta.url), 'utf8'));

test('standalone contract agrees with engine and returns sorted, independent notes', () => {
  assert.deepEqual(TRACK_IDS, TRACKS.map(t => t.id));
  const input = example(); input.score.notes.reverse();
  const result = validateComposition(JSON.stringify(input));
  assert.equal(result.score.duration, result.score.bars.length * 4 * 60 / result.score.bpm);
  assert.ok(result.score.notes.every((n, i, a) => i === 0 || a[i-1].beat <= n.beat));
  assert.deepEqual(input.score.notes, example().score.notes.reverse());
});

test('contract rejects malformed, unsupported and inconsistent data with field paths', () => {
  const cases: [string, (x: any) => void][] = [
    ['version', x => x.version = 2], ['work.id', x => x.work.id = '../x'],
    ['score.bpm', x => x.score.bpm = 0], ['score.duration', x => x.score.duration += 1],
    ['score.sections[0].startBar', x => x.score.sections[0].startBar = 1],
    ['score.sections', x => x.score.sections[0].bars -= 1],
    ['score.bars[0].section', x => x.score.bars[0].section = 1],
    ['score.notes[0].pitch', x => x.score.notes[0].pitch = 128],
    ['score.notes[0].velocity', x => x.score.notes[0].velocity = 0],
    ['score.notes[0].track', x => x.score.notes[0].track = 'voice'],
    ['score.notes[0].duration', x => x.score.notes[0].duration = -1],
    ['score.notes[0]', x => x.score.notes[0].beat = x.score.bars.length * 4],
    ['score.sections[0].color', x => x.score.sections[0].color = 'red;position:fixed'],
    ['comparisonSections', x => x.comparisonSections = { intro: 0, verse: 0 }],
    ['score.notes', x => x.score.notes = []],
    ['score.notes', x => x.score.notes = Array.from({length: 257}, () => ({...x.score.notes[0], beat: 0, duration: 1}))],
  ];
  for (const [path, change] of cases) { const input = example(); change(input); assert.throws(() => validateComposition(JSON.stringify(input)), error => error instanceof Error && error.message.includes(path), path); }
  for (const text of ['{', 'null', '[]', ' '.repeat(MAX_FILE_BYTES + 1)]) assert.throws(() => validateComposition(text));
});

test('local library is transactional, retains explicit work identity and protects built-ins', () => {
  const data = new Map<string,string>(); let fail = false;
  const storage = { getItem: (k:string) => data.get(k) ?? null, setItem: (k:string,v:string) => { if(fail) throw new Error('quota'); data.set(k,v); } };
  const library = new ImportedLibrary(storage, WORKS, SONGS);
  const a = library.add(validateComposition(JSON.stringify(example())));
  assert.equal(library.songs.length, 1); assert.equal(library.works.length, 1);
  assert.throws(() => library.add(a), /已存在/);
  const b = {...a, revision: {...a.revision, id:'example-v2'}};
  library.add(b); assert.equal(library.works.length, 1); assert.equal(library.songs.length, 2);
  assert.equal(new ImportedLibrary(storage, WORKS, SONGS).songs.length, 2);
  assert.throws(() => library.add({...a, revision:{...a.revision,id:SONGS[0].id}}), /已存在/);
  assert.throws(() => library.add({...b, work:{...b.work,title:'different'}, score:{...b.score,title:'different'}, revision:{...b.revision,id:'example-v3'}}), /标题/);
  fail = true; assert.throws(() => library.remove(b.revision.id)); assert.equal(library.songs.length, 2);
  assert.throws(() => library.add({...a,revision:{...a.revision,id:'example-v3'}})); assert.equal(library.songs.length, 2);
  fail = false; library.remove(a.revision.id); assert.equal(library.works[0].defaultVersionId,b.revision.id);
  library.remove(b.revision.id); assert.equal(library.works.length,0);
  assert.throws(() => library.remove(SONGS[0].id), /导入/);
  data.set(STORAGE_KEY, '{'); assert.ok(new ImportedLibrary(storage,WORKS,SONGS).warning);
});

import { midiToComposition } from '../src/music/import/midi.ts';
import { scoreToMidi } from '../src/midi.ts';
import MidiPackage from '@tonejs/midi';

test('MIDI imports a fixed tempo score through the same validation, preserves note events', () => {
  const doc=validateComposition(JSON.stringify(example()));
  const bytes=scoreToMidi(doc.score,'Window Study');
  const imported=midiToComposition(bytes,'study.mid','midi-study');
  assert.equal(imported.score.bpm,96); assert.equal(imported.score.duration,20);
  assert.equal(imported.score.notes.length,doc.score.notes.length);
  for(const note of doc.score.notes) assert.ok(imported.score.notes.some(n => n.track===note.track && n.pitch===note.pitch && Math.abs(n.beat-note.beat)<.003 && Math.abs(n.duration-note.duration)<.003));
  const {Midi}=MidiPackage; const midi=new Midi(bytes);
  midi.header.tempos.push({ticks:480,bpm:120}); midi.header.update();
  assert.throws(()=>midiToComposition(midi.toArray(),'x.mid','midi-x'),/变速/);
  const other=new Midi(bytes); other.header.timeSignatures[0].timeSignature=[3,4];
  assert.throws(()=>midiToComposition(other.toArray(),'x.mid','midi-x'),/4\/4/);
  const instrument=new Midi();instrument.header.setTempo(96);instrument.addTrack().instrument.number=24;instrument.tracks[0].addNote({midi:60,time:0,duration:1});
  assert.throws(()=>midiToComposition(instrument.toArray(),'x.mid','midi-x'),/音色/);
  assert.throws(()=>midiToComposition(new Uint8Array([1,2,3]),'x.mid','midi-x'),/MIDI/);
});

import { buildAuthoringPrompt } from '../src/music/authoring/prompt.ts';
test('phrase-first prompt makes exact length explicit and expands the same project with a new revision', () => {
  const doc=example();
  assert.match(buildAuthoringPrompt('four',doc),/4 小节/);
  assert.match(buildAuthoringPrompt('eight',doc),/8 小节/);
  const expanded=buildAuthoringPrompt('expand',doc);
  assert.ok(expanded.includes('window-study'));
  assert.ok(expanded.includes('window-study-v1'));
  assert.match(expanded,/保留.*work.id/);
  assert.match(expanded,/新的 revision.id/);
  assert.match(expanded,/window-study-v1.json/);
});

test('built-in downloads can be handed to an external agent through the same contract', () => {
  for(const song of SONGS) assert.doesNotThrow(()=>validateComposition(JSON.stringify({format:'music-room-score',version:1,work:{id:song.workId,title:song.title},revision:{id:song.id,label:song.edition,englishTitle:song.englishTitle},comparisonSections:song.comparisonSections,score:song.compose()})));
});


test('both original MIDI exports are importable with all original note events', () => {
  for(const song of SONGS) { const score=song.compose(); const doc=midiToComposition(scoreToMidi(score),`${song.id}.mid`,'midi-original'); assert.equal(doc.score.notes.length,score.notes.length); }
});
