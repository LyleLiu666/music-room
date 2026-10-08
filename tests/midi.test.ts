import { test } from 'node:test';
import assert from 'node:assert/strict';
import MidiPackage from '@tonejs/midi';
import { TRACKS } from '../src/music/score.ts';
import { SONGS } from '../src/catalog.ts';
import { scoreToMidi } from '../src/midi.ts';
import { audible, defaultMix } from '../src/audio.ts';
const { Midi } = MidiPackage;

test('MIDI round-trip preserves every note, tempo, channel and section marker', () => {
  for (const song of SONGS) {
    const score = song.compose();
    const midi = new Midi(scoreToMidi(score));
    assert.equal(midi.header.tempos[0].bpm, score.bpm);
    assert.equal(midi.tracks.length, TRACKS.length);
    assert.equal(midi.tracks.flatMap(t => t.notes).length, score.notes.length);
    assert.equal(midi.header.meta.filter(m => m.type === 'marker').length, score.sections.length);
    for (const track of midi.tracks) {
      const info = TRACKS.find(t => t.id === track.name)!;
      const percussion = ['kick','snare','hat','cymbal'].includes(info.id);
      assert.equal(track.channel === 9, percussion);
      assert.equal(track.instrument.number, info.program);
      const originals = score.notes.filter(n => n.track === info.id);
      assert.ok(Math.abs(track.notes[0].time - originals[0].beat * 60 / score.bpm) < .003);
    }
  }
});

test('another composition exports its own title, tempo and section names', () => {
  const score = { ...SONGS[0].compose(), title: '另一首', bpm: 120,
    sections: [{ name: '开场', midiName: 'Opening', subtitle: '', startBar: 0, bars: 72, color: '#ccc' }] };
  const midi = new Midi(scoreToMidi(score, 'Another Piece'));
  assert.equal(midi.header.name, 'Another Piece');
  assert.equal(midi.header.tempos[0].bpm, 120);
  assert.deepEqual(midi.header.meta.filter(m => m.type === 'marker').map(m => m.text), ['Opening']);
});

test('solo and mute combine consistently for preview and exported mixes', () => {
  const mix = defaultMix();
  assert.ok(TRACKS.every(t => audible(t.id, mix)));
  mix.solo.add('melody'); mix.solo.add('flute');
  assert.ok(audible('melody', mix)); assert.ok(audible('flute', mix));
  assert.ok(!audible('bass', mix));
  mix.muted.add('melody');
  assert.ok(!audible('melody', mix)); assert.ok(audible('flute', mix));
});
