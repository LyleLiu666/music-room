import MidiPackage from '@tonejs/midi';
import { TRACKS, type Score } from './music/score.ts';
const { Midi } = MidiPackage;
export function scoreToMidi(score: Score, title = 'Music Room'): Uint8Array {
  const midi = new Midi();
  // SMF text interoperability is inconsistent; use ASCII identifiers in the
  // exchange file and retain full Chinese labels in the JSON/browser project.
  midi.header.name = title;
  midi.header.setTempo(score.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  const labels: Record<string, string> = { '引子': 'Intro', '主题 A': 'Verse A', '过渡': 'Pre-Chorus', '副歌': 'Chorus', '间奏': 'Interlude', '再现': 'Final Chorus', '尾声': 'Outro' };
  for (const [i, section] of score.sections.entries()) midi.header.meta.push({ ticks: section.startBar * 4 * midi.header.ppq, type: 'marker', text: section.midiName ?? labels[section.name] ?? `Section ${i + 1}` });
  midi.header.update();
  let channel = 0;
  for (const info of TRACKS) {
    const track = midi.addTrack(); track.name = info.id;
    const drums = ['kick','snare','hat','cymbal'].includes(info.id);
    if (channel === 9) channel++;
    track.channel = drums ? 9 : channel++;
    track.instrument.number = info.program;
    for (const note of score.notes.filter(n => n.track === info.id)) {
      track.addNote({ midi: note.pitch, time: note.beat * 60 / score.bpm, duration: note.duration * 60 / score.bpm, velocity: note.velocity });
    }
  }
  return midi.toArray();
}
