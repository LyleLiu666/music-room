import { writeFile } from 'node:fs/promises';

// Standalone Node.js composition, no third-party packages or project imports.
// Run: node compose.mjs. Re-running reproduces this revision exactly.
// Future revisions KEEP WORK; change REVISION.id and label in a new directory.
const WORK = { id: 'sea-breeze-f692a4e5', title: '海风留白' };
const REVISION = {
  id: 'sea-breeze-v2-d11a77b2',
  label: 'v2 · 往前走的律动',
  summary: '回应 v1 节奏偏慢：短音切分钢琴、活跃贝斯、连续八分踩镲；仍为96 BPM、4/4、八小节。',
  description: '保留同一作品的D大调和声方向与两小节主题轮廓，重新写旋律节奏。第1—2小节开门进入并以切分推进，第3—4小节下行回答，第5—6小节同节奏抬高再现，第7—8小节收束。伴奏由长和弦改为短促节奏，贝斯与底鼓相互呼应，踩镲维持八分脉冲，军鼓更清晰。只在收束时拉长旋律和和弦。固定速度未改变，主观推进感需要实际试听确认；尚未试听。',
  key: 'D 大调',
  englishTitle: 'Room for the Sea Breeze',
};
const BPM = 96;
const BAR_COUNT = 8;
const BEATS_PER_BAR = 4;
const notes = [];
const round = value => Number(value.toFixed(5));
function note(track, pitch, beat, duration, velocity) {
  notes.push({ track, pitch, beat: round(beat), duration: round(duration), velocity });
}
function chord(pitches, beat, duration, velocity) {
  pitches.forEach((pitch, i) => note('piano', pitch, beat, duration, round(velocity - i * 0.012)));
}

// Each tuple is [local beat, MIDI pitch, duration in beats, velocity].
// Theme: F# A E D | C# B A F#. Offbeat attacks add motion without runs.
// Answer: B D C# B | A G F#. Return raises the crest from E5 to F#5.
const melodyBars = [
  [[0, 66, 0.4, 0.78], [0.75, 69, 0.45, 0.83], [1.5, 76, 0.9, 0.8], [3, 74, 0.7, 0.75]],
  [[0, 73, 0.7, 0.76], [1, 71, 0.4, 0.7], [1.5, 69, 0.8, 0.74], [3, 66, 0.7, 0.72]],
  [[0, 71, 0.4, 0.75], [0.75, 74, 0.45, 0.78], [1.5, 73, 0.9, 0.74], [3, 71, 0.7, 0.71]],
  [[0, 69, 0.7, 0.72], [1.5, 67, 0.45, 0.67], [2.5, 66, 1, 0.7]],
  [[0, 66, 0.4, 0.8], [0.75, 69, 0.45, 0.84], [1.5, 78, 0.9, 0.86], [3, 76, 0.7, 0.8]],
  [[0, 74, 0.7, 0.79], [1, 71, 0.4, 0.72], [1.5, 69, 0.8, 0.76], [3, 67, 0.7, 0.74]],
  [[0, 74, 0.7, 0.76], [1, 76, 0.4, 0.77], [1.5, 74, 0.4, 0.71], [2, 73, 1.5, 0.73]],
  [[0, 76, 0.4, 0.69], [0.75, 74, 2.75, 0.76]],
];
melodyBars.forEach((bar, i) => bar.forEach(([beat, pitch, duration, velocity]) => {
  note('melody', pitch, i * BEATS_PER_BAR + beat, duration, velocity);
}));

// Same harmonic path as v1, but short three-hit accompaniment patterns.
// Pattern B answers A rather than mechanically copying every bar.
const harmony = [
  { label: 'Dmaj9', voicing: [54, 57, 61, 64] },
  { label: 'A(add9)/C#', voicing: [57, 59, 64] },
  { label: 'Bm7', voicing: [57, 62, 66] },
  { label: 'Gmaj9', voicing: [54, 57, 59, 62] },
  { label: 'Dmaj9/F#', voicing: [57, 61, 64] },
  { label: 'Em7', voicing: [55, 59, 62] },
  { label: 'Asus4 → A(add9)', voicing: [57, 62, 64] },
  { label: 'D6/9', voicing: [54, 57, 59, 64] },
];
const compA = [[0, 0.55, 0.47], [1.5, 0.4, 0.41], [2.5, 0.55, 0.45]];
const compB = [[0.5, 0.4, 0.42], [2, 0.55, 0.46], [3.5, 0.35, 0.4]];
harmony.slice(0, 6).forEach((bar, i) => {
  (i % 2 ? compB : compA).forEach(([beat, duration, velocity]) => {
    chord(bar.voicing, i * 4 + beat, duration, round(velocity + (i === 4 ? 0.015 : 0)));
  });
});
chord(harmony[6].voicing, 24, 0.55, 0.46);
chord([57, 59, 61, 64], 26, 0.85, 0.43);
chord(harmony[7].voicing, 28, 3.5, 0.43);

// Short bass attacks: root, fifth/chord tone, root, octave/chord tone.
// Alternating positions lock to the kick, with only the final root sustained.
const bassPitches = [
  [38, 45, 38, 50], [37, 40, 37, 45], [35, 42, 35, 47],
  [43, 50, 43, 47], [42, 45, 42, 50], [40, 47, 40, 52], [33, 40, 33, 45],
];
const bassA = [[0, 0.65, 0.6], [1.5, 0.4, 0.49], [2.5, 0.6, 0.56], [3.5, 0.35, 0.47]];
const bassB = [[0, 0.65, 0.58], [1, 0.4, 0.48], [2, 0.6, 0.56], [3.5, 0.35, 0.5]];
bassPitches.forEach((pitches, i) => (i % 2 ? bassB : bassA).forEach(([beat, duration, velocity], j) => {
  note('bass', pitches[j], i * 4 + beat, duration, velocity);
}));
note('bass', 38, 28, 3.5, 0.56);

// Continuous eighth-note hats make the pulse more apparent at the SAME BPM.
// Snare moves closer to the grid than v1; no random timing or tempo changes.
for (let bar = 0; bar < 8; bar++) {
  const start = bar * 4;
  if (bar === 7) {
    note('kick', 36, start, 0.15, 0.53);
    note('snare', 38, start + 1.01, 0.12, 0.36);
    [0, 0.5, 1, 1.5, 2, 2.5].forEach((beat, i) => note('hat', 42, start + beat, 0.075, round(0.26 - i * 0.025)));
    continue;
  }
  const kickHits = bar % 2 ? [[0, 0.59], [2, 0.53], [3.5, 0.45]] : [[0, 0.62], [1.5, 0.47], [2.5, 0.55]];
  kickHits.forEach(([beat, velocity]) => note('kick', 36, start + beat, 0.15, velocity));
  note('snare', 38, start + 1.01, 0.12, bar === 4 ? 0.48 : 0.43);
  note('snare', 38, start + 3.01, 0.12, bar === 3 ? 0.4 : 0.46);
  for (let eighth = 0; eighth < 8; eighth++) {
    const offbeat = eighth % 2 === 1;
    const velocity = offbeat ? (eighth === 5 ? 0.24 : 0.21) : (eighth === 0 ? 0.32 : 0.29);
    note('hat', 42, start + eighth * 0.5 + (offbeat ? 0.008 : 0), 0.075, velocity);
  }
}

const song = {
  format: 'music-room-score', version: 1, work: WORK, revision: REVISION,
  comparisonSections: { theme: 0 },
  score: {
    title: WORK.title, bpm: BPM, duration: BAR_COUNT * BEATS_PER_BAR * 60 / BPM,
    sections: [{ name: '主题试写', midiName: 'Theme', subtitle: '短音切分 riff → 下行回答 → 抬高再现 → 长音收束', startBar: 0, bars: BAR_COUNT, color: '#7eaaa5' }],
    bars: harmony.map(bar => ({ chord: bar.label, section: 0 })),
    notes: notes.sort((a, b) => a.beat - b.beat || a.track.localeCompare(b.track) || a.pitch - b.pitch),
  },
};
await writeFile(new URL('./song.json', import.meta.url), `${JSON.stringify(song, null, 2)}\n`, 'utf8');
console.log(`${WORK.title} / ${REVISION.label}: ${BAR_COUNT} bars, ${song.score.duration}s, ${notes.length} notes`);
