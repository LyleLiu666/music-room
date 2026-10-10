import { writeFile } from 'node:fs/promises';

// Standalone composition: Node.js only, no Music Room source or dependencies.
// Run: node compose.mjs. A rerun reproduces this revision exactly.
// For a later revision, copy this directory, KEEP WORK, replace REVISION.id
// with a fresh lower-case UUID-based ID and set a new label. Keep old files.
const WORK = { id: 'sea-breeze-f692a4e5', title: '海风留白' };
const REVISION = {
  id: 'sea-breeze-v1-12c88a17',
  label: 'v1 · 八小节主题试写',
  summary: '钢琴两小节 riff、下行回答、抬高再现与长音收束；96 BPM，4/4，20 秒。',
  description: '原创器乐短句。以明亮而略带惆怅的和声、轻切分与呼吸感回应听众的夏日音乐偏好。第1—2小节陈述主题，第3—4小节回答，第5—6小节保留主题节奏并抬高旋律，第7—8小节经挂留和弦回到D。钢琴主旋律与中低音和弦、贝斯、轻鼓；无其他音色、无示例旋律复用。尚未实际试听，需用 Music Room 本机音色验收。',
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
  // Shape the inner voices; the bass owns the low register.
  pitches.forEach((pitch, i) => note('piano', pitch, beat, duration, round(velocity - i * 0.012)));
}

// All positions below are local quarter-note beats, counted from zero.
// Deliberate melody rests replace tiny connecting runs. No random humanization.
// 1–2: F#4 A4 E5 | D5 A4 F#4, six notes across two bars.
// 3–4: B4 D5 C#5 | B4 A4 G4, a lower, descending answer.
// 5–6: same rhythm, higher crest: F#4 A4 F#5 | E5 B4 G4.
// 7–8: D5 C#5 | E5 D5, suspended-to-resolved cadence.
const melodyBars = [
  [[0.5, 66, 0.45, 0.72], [1, 69, 0.8, 0.79], [2.5, 76, 1.25, 0.76]],
  [[0, 74, 1.45, 0.72], [2, 69, 0.45, 0.66], [2.5, 66, 0.95, 0.69]],
  [[0.5, 71, 0.9, 0.71], [1.5, 74, 0.4, 0.74], [2, 73, 1.5, 0.69]],
  [[0, 71, 0.95, 0.67], [1.5, 69, 0.45, 0.63], [2, 67, 1.45, 0.65]],
  [[0.5, 66, 0.45, 0.74], [1, 69, 0.8, 0.8], [2.5, 78, 1.25, 0.82]],
  [[0, 76, 1.45, 0.76], [2, 71, 0.45, 0.69], [2.5, 67, 0.95, 0.7]],
  [[0.5, 74, 0.9, 0.7], [2, 73, 1.7, 0.67]],
  [[0, 76, 0.45, 0.65], [0.5, 74, 2.75, 0.71]],
];
melodyBars.forEach((bar, i) => bar.forEach(([beat, pitch, duration, velocity]) => {
  note('melody', pitch, i * 4 + beat, duration, velocity);
}));

// Compact, voice-led accompaniment. The last bar holds instead of restating
// the comping pattern. In bar 7 D resolves to C# at local beat 2.
const harmony = [
  { label: 'Dmaj9', voicing: [54, 57, 61, 64], attacks: [[0, 1.6, 0.4], [2.25, 1.2, 0.35]] },
  { label: 'A(add9)/C#', voicing: [57, 59, 64], attacks: [[0, 1.65, 0.38], [2.5, 0.95, 0.34]] },
  { label: 'Bm7', voicing: [57, 62, 66], attacks: [[0, 1.7, 0.39], [2.5, 0.95, 0.35]] },
  { label: 'Gmaj9', voicing: [54, 57, 59, 62], attacks: [[0, 2.9, 0.37]] },
  { label: 'Dmaj9/F#', voicing: [57, 61, 64], attacks: [[0, 1.6, 0.42], [2.25, 1.2, 0.37]] },
  { label: 'Em7', voicing: [55, 59, 62], attacks: [[0, 1.65, 0.39], [2.5, 0.95, 0.35]] },
  { label: 'Asus4 → A(add9)', voicing: [57, 62, 64], attacks: [[0, 1.75, 0.38]] },
  { label: 'D6/9', voicing: [54, 57, 59, 64], attacks: [[0, 3.25, 0.4]] },
];
harmony.forEach((bar, i) => bar.attacks.forEach(([beat, duration, velocity]) => {
  chord(bar.voicing, i * 4 + beat, duration, velocity);
}));
chord([57, 59, 61, 64], 26, 1.5, 0.35);

// Root movement D–C#–B–G / F#–E–A–D gives the phrase direction.
// Occasional fifths and anticipatory pulses keep it relaxed but moving.
const bassBars = [
  [[0, 38, 1.4, 0.55], [1.75, 45, 0.55, 0.43], [2.5, 38, 0.95, 0.5]],
  [[0, 37, 1.65, 0.53], [2.5, 40, 0.7, 0.45], [3.5, 37, 0.35, 0.46]],
  [[0, 35, 1.4, 0.54], [1.75, 42, 0.55, 0.44], [2.5, 35, 0.95, 0.49]],
  [[0, 43, 2.9, 0.51]],
  [[0, 42, 1.4, 0.56], [1.75, 45, 0.55, 0.45], [2.5, 42, 0.95, 0.52]],
  [[0, 40, 1.65, 0.53], [2.5, 47, 0.7, 0.44], [3.5, 40, 0.35, 0.46]],
  [[0, 33, 1.5, 0.53], [2, 40, 0.7, 0.44], [3, 33, 0.65, 0.47]],
  [[0, 38, 3.25, 0.54]],
];
bassBars.forEach((bar, i) => bar.forEach(([beat, pitch, duration, velocity]) => {
  note('bass', pitch, i * 4 + beat, duration, velocity);
}));

// Light backbeat: snare slightly behind the grid, hats with softer offbeats.
// Timing offsets are fractions of a beat, NOT a change of tempo or swing map.
// Four authored variants retain the groove while the phrase breathes.
const groove = [
  { kicks: [[0, 0.52], [2.5, 0.43]], snares: [[1.025, 0.34], [3.025, 0.37]], hats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
  { kicks: [[0, 0.49], [1.75, 0.38], [2.5, 0.42]], snares: [[1.025, 0.33], [3.025, 0.36]], hats: [0, 0.5, 1, 2, 2.5, 3, 3.5] },
  { kicks: [[0, 0.5], [2.5, 0.4]], snares: [[1.025, 0.32], [3.025, 0.35]], hats: [0, 0.5, 1, 1.5, 2, 2.5, 3] },
  { kicks: [[0, 0.46], [2, 0.36]], snares: [[1.025, 0.3], [3.025, 0.31]], hats: [0, 0.5, 1, 2, 2.5] },
  { kicks: [[0, 0.54], [2.5, 0.45]], snares: [[1.025, 0.36], [3.025, 0.39]], hats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
  { kicks: [[0, 0.51], [1.75, 0.39], [2.5, 0.43]], snares: [[1.025, 0.34], [3.025, 0.37]], hats: [0, 0.5, 1, 2, 2.5, 3, 3.5] },
  { kicks: [[0, 0.48], [2, 0.4]], snares: [[1.025, 0.33], [3.025, 0.32]], hats: [0, 0.5, 1, 1.5, 2, 2.5, 3] },
  { kicks: [[0, 0.44]], snares: [], hats: [[0, 0.2], [0.5, 0.13]] },
];
groove.forEach((bar, i) => {
  bar.kicks.forEach(([beat, velocity]) => note('kick', 36, i * 4 + beat, 0.15, velocity));
  bar.snares.forEach(([beat, velocity]) => note('snare', 38, i * 4 + beat, 0.12, velocity));
  bar.hats.forEach(hit => {
    const [beat, velocity] = Array.isArray(hit) ? hit : [hit, hit % 1 ? 0.16 : 0.24];
    note('hat', 42, i * 4 + beat + (beat % 1 ? 0.018 : 0), 0.075, velocity);
  });
});

const song = {
  format: 'music-room-score',
  version: 1,
  work: WORK,
  revision: REVISION,
  comparisonSections: { theme: 0 },
  score: {
    title: WORK.title,
    bpm: BPM,
    duration: BAR_COUNT * BEATS_PER_BAR * 60 / BPM,
    sections: [{ name: '主题试写', midiName: 'Theme', subtitle: '两小节 riff → 回答 → 抬高再现 → 收束', startBar: 0, bars: BAR_COUNT, color: '#7eaaa5' }],
    bars: harmony.map(bar => ({ chord: bar.label, section: 0 })),
    notes: notes.sort((a, b) => a.beat - b.beat || a.track.localeCompare(b.track) || a.pitch - b.pitch),
  },
};
const destination = new URL('./song.json', import.meta.url);
await writeFile(destination, `${JSON.stringify(song, null, 2)}\n`, 'utf8');
console.log(`${WORK.title} / ${REVISION.label}: ${BAR_COUNT} bars, ${song.score.duration}s, ${notes.length} notes`);
