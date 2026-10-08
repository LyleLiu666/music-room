import { type Note, type TrackId, type Section, type Score } from '../music/score.ts';

const SECTIONS: Section[] = [
  { name: '引子', subtitle: '两小节 riff，第一次问答', startBar: 0, bars: 8, color: '#899b70' },
  { name: '主题 A', subtitle: '主题重现，回答句变化', startBar: 8, bars: 16, color: '#b29c73' },
  { name: '过渡', subtitle: '长音与留白，弦乐逐渐进入', startBar: 24, bars: 8, color: '#8ca6a0' },
  { name: '副歌', subtitle: '同一节奏轮廓，旋律抬高展开', startBar: 32, bars: 16, color: '#cce7a4' },
  { name: '间奏', subtitle: '钢琴退场，长笛接过 riff', startBar: 48, bars: 8, color: '#a4b6cc' },
  { name: '再现', subtitle: '熟悉的主题，新的收束与力度', startBar: 56, bars: 12, color: '#d3b986' },
  { name: '尾声', subtitle: 'riff 留下半句，落回主和弦', startBar: 68, bars: 4, color: '#8e947f' },
];
type Harmony = { bass: number; tones: number[] };
const H: Record<string, Harmony> = {
  Dm: { bass: 38, tones: [50,57,62,65] }, Bb: { bass: 34, tones: [53,58,62,65] },
  F: { bass: 29, tones: [53,57,60,65] }, C: { bass: 36, tones: [52,55,60,64] },
  Gm: { bass: 31, tones: [50,55,58,62] }, Am: { bass: 33, tones: [52,57,60,64] },
  A7: { bass: 33, tones: [52,55,61,64] }, A7sus4: { bass: 33, tones: [52,57,62,64] },
  'C/E': { bass: 40, tones: [52,55,60,64] }, Bbadd2: { bass: 34, tones: [53,58,60,62] },
  'Dm(add9)': { bass: 38, tones: [50,57,64,65] },
};
const VERSE = ['Dm','Bb','F','C','Dm','Bb','Gm','A7'];
const CHORUS = ['F','C/E','Dm','Bb','F','C/E','Gm','C','F','C/E','Dm','Bb','F','C/E','Gm','A7'];
const HARMONIES = [
  ...VERSE, ...VERSE, ...VERSE,
  ...['Bb','C','Am','Dm','Gm','Bbadd2','A7sus4','A7'],
  ...CHORUS,
  ...['Dm','Bb','F','C','Gm','Bbadd2','A7sus4','A7'],
  ...CHORUS.slice(0,8), ...['F','C/E','Bb','A7'],
  ...['Dm','Bb','A7sus4','Dm(add9)'],
];

// Four/eight-bar phrases share a two-bar question. The answers and accompaniment
// are independently written; a phrase is never filled by a random scale walk.
// Durations include rests (pitch zero), making the breathing part of the score.
type Bar = [number, number][];
const RIFF: Bar[] = [
  [[0,.5],[69,.5],[74,.75],[77,.25],[76,.5],[74,1.5]],
  [[72,1.5],[69,.5],[67,.5],[69,1],[0,.5]],
];
const ANSWER_A: Bar[] = [
  [[69,.5],[72,.5],[77,2.25],[76,.25],[0,.5]],
  [[74,.5],[72,2],[0,1.5]],
];
const ANSWER_B: Bar[] = [
  [[70,.5],[74,.5],[77,2],[74,.5],[0,.5]],
  [[76,1],[73,1.5],[0,1.5]],
];
const ANSWER_C: Bar[] = [
  [[72,.5],[77,.5],[79,2],[77,.5],[0,.5]],
  [[76,.5],[74,.5],[72,2],[0,1]],
];
const REFRAIN: Bar[] = [
  [[0,.5],[72,.5],[77,.75],[81,.25],[79,.5],[77,1.5]],
  [[76,1.5],[72,.5],[74,.5],[72,1],[0,.5]],
];
const CHORUS_ANSWER_A: Bar[] = [
  [[77,.5],[76,.5],[74,2.5],[0,.5]],
  [[72,.5],[74,.5],[77,2],[0,1]],
];
const CHORUS_ANSWER_B: Bar[] = [
  [[74,.5],[77,.5],[79,2],[77,.5],[0,.5]],
  [[76,.5],[74,.5],[72,2],[0,1]],
];
const CHORUS_ANSWER_C: Bar[] = [
  [[77,.5],[79,.5],[81,2],[79,.5],[0,.5]],
  [[77,1],[74,1.5],[0,1.5]],
];
const CHORUS_ANSWER_D: Bar[] = [
  [[79,.5],[77,.5],[74,2.5],[0,.5]],
  [[76,.5],[73,2],[0,1.5]],
];
const PRE: Bar[] = [
  [[0,.5],[74,.5],[77,2.5],[0,.5]],
  [[76,.5],[74,.5],[72,2],[0,1]],
  [[72,.5],[76,.5],[79,2],[76,.5],[0,.5]],
  [[77,1],[74,2],[0,1]],
  [[74,.5],[77,.5],[79,2.5],[0,.5]],
  [[77,.5],[74,.5],[72,2],[0,1]],
  [[74,.5],[76,.5],[81,2],[0,1]],
  [[79,.5],[76,.5],[73,1.5],[0,1.5]],
];
const BRIDGE: Bar[] = [
  ...RIFF, ...ANSWER_A,
  [[0,.5],[70,.5],[74,.75],[77,.25],[79,.5],[77,1.5]],
  [[74,1.5],[72,.5],[69,.5],[70,1],[0,.5]],
  [[74,.5],[76,.5],[81,2],[0,1]],
  [[79,.5],[76,.5],[73,1.5],[0,1.5]],
];
const OUTRO: Bar[] = [
  RIFF[0], [[72,1.5],[69,1],[0,1.5]],
  [[74,1],[76,1],[0,2]], [[74,1.5],[0,2.5]],
];
const MELODY: Bar[] = [
  ...RIFF, ...ANSWER_A, ...RIFF, ...ANSWER_B,
  ...RIFF, ...ANSWER_A, ...RIFF, ...ANSWER_B,
  ...RIFF, ...ANSWER_C, ...RIFF, ...ANSWER_B,
  ...PRE,
  ...REFRAIN, ...CHORUS_ANSWER_A, ...REFRAIN, ...CHORUS_ANSWER_B,
  ...REFRAIN, ...CHORUS_ANSWER_C, ...REFRAIN, ...CHORUS_ANSWER_D,
  ...BRIDGE,
  ...REFRAIN, ...CHORUS_ANSWER_C, ...REFRAIN, ...CHORUS_ANSWER_B,
  ...REFRAIN, ...[[[77,.5],[79,.5],[81,2],[0,1]], [[79,.5],[76,.5],[73,1.5],[0,1.5]]] as Bar[],
  ...OUTRO,
];

export function compose(): Score {
  const notes: Note[] = [];
  const add = (track: TrackId, bar: number, offset: number, pitch: number, duration: number, velocity: number) => {
    // Performance variation is deliberately small; phrase and rhythm carry the expression.
    const displacement = Math.sin(bar * 1.37 + pitch * .19 + offset) * .009;
    const beat = Math.max(0, bar * 4 + offset + displacement);
    if (pitch && beat + duration < 287) notes.push({ track, pitch, beat, duration, velocity });
  };
  let stringVoices = [57,62,65];
  for (let bar = 0; bar < 72; bar++) {
    const h = H[HARMONIES[bar]], phraseBar = bar % 4;
    const intro = bar < 8, verse = bar >= 8 && bar < 24, pre = bar >= 24 && bar < 32;
    const chorus = bar >= 32 && bar < 48, bridge = bar >= 48 && bar < 56, final = bar >= 56 && bar < 68, outro = bar >= 68;
    const full = chorus || final;
    let cursor = 0;
    for (const [pitch, duration] of MELODY[bar]) {
      const velocity = (full ? .82 : bridge ? .65 : pre ? .72 : .69) + (duration >= 1.5 ? -.035 : .025) + Math.sin(bar * .31 + cursor) * .027;
      add(bridge ? 'flute' : 'melody', bar, cursor, pitch, duration * .95, velocity);
      // Only a phrase-ending octave is added in the final reprise.
      if (final && phraseBar === 3 && pitch && duration >= 1.5) add('melody', bar, cursor + .024, pitch - 12, duration * .92, .32);
      cursor += duration;
    }
    if (bar === 71) {
      [h.bass + 12, ...h.tones].forEach((p, i) => add('piano', bar, i * .028, p, 1.12, .43));
      continue;
    }
    // Sparse left-hand accompaniment gives the melody its own register and time.
    if (intro || outro || bridge) {
      add('piano', bar, 0, h.bass + 12, 1.8, intro ? .46 : .39);
      h.tones.slice(1, 3).forEach((p, i) => add('piano', bar, 1.5 + i * .022, p, 1.6, .35));
      if (phraseBar === 3) add('piano', bar, 3.25, h.tones[3], .55, .31);
    } else {
      add('piano', bar, 0, h.bass + 12, 1.3, .38);
      // A small answer only in the written melody's breathing space.
      if (phraseBar === 3) [0,.4].forEach((t, i) => add('piano', bar, 2.9 + t, h.tones[2 - i] + 12, .45, .3));
    }
    if (verse || pre || full || bridge) {
      const hits = full ? [0,2.5] : bridge ? [0] : [0,2.75];
      hits.forEach((t, i) => h.tones.slice(1).forEach((p, j) => add('rhodes', bar, t + j * .014, p, i === 0 ? 1.6 : .68, full ? .58 : bridge ? .4 : .48)));
    }
    // Riff accompaniment does not double every lead note.
    if ((full || verse && bar >= 16 || bridge) && phraseBar === 3) {
      const tail = bar === 55 || bar === 67 ? [2.75,3.25] : [2.6,3.1,3.6];
      tail.forEach((t, i) => add('pluck', bar, t, h.tones[(i + 1) % 4] + 12, .42, bridge ? .48 : .36));
    }
    if (bar >= 8 && !outro || bar === 7) {
      const rootDuration = bridge && bar < 52 ? 2.8 : 1.3;
      add('bass', bar, 0, h.bass, rootDuration, .77);
      if (!bridge || bar >= 52) {
        add('bass', bar, 2.5, h.bass + (full ? 12 : 0), .83, .68);
        if (phraseBar === 3 || full) add('bass', bar, 3.5, h.bass + 7, .3, .56);
        if (bar % 8 === 7) add('bass', bar, 3.85, H[HARMONIES[bar + 1]].bass - 1, .12, .46);
      }
    }
    // Slowly moving strings enter late, swell in the refrain, then withdraw.
    if (pre && bar >= 28 || full || verse && bar >= 20) {
      stringVoices = stringVoices.map((previous, i) => {
        const candidates = h.tones.flatMap(p => [p,p + 12]).filter(p => p >= 55 + i * 3 && p <= 74 + i * 3);
        return candidates.reduce((a, b) => Math.abs(a - previous) < Math.abs(b - previous) ? a : b);
      });
      stringVoices.forEach((pitch, i) => add('strings', bar, .055 * i, pitch, 3.68, final ? .56 : chorus ? .47 : .3));
    }
    // A flute answer is heard only while the last melody note rests.
    if (full && phraseBar === 3 && bar % 8 === 7) {
      [h.tones[2] + 12,h.tones[1] + 12].forEach((p, i) => add('flute', bar, 2.9 + i * .5, p, .43, .31));
    }
    if (bar >= 8 && !outro || bar === 7) {
      const halfTime = bridge && bar < 52;
      const kicks = halfTime ? [0] : full ? [0,1.5,2,2.75] : [0,1.75,2.5];
      kicks.forEach((t, i) => add('kick', bar, t, 36, .19, i === 0 ? .81 : .62));
      (halfTime ? [2] : [1,3]).forEach(t => add('snare', bar, t + .025, 38, .21, full ? .77 : .6));
      const hats = halfTime ? [0,1,2,3] : [0,.5,1,1.5,2,2.5,3,3.5];
      hats.forEach(t => add('hat', bar, t + (t % 1 ? .045 : 0), full && t === 3.5 && phraseBar === 3 ? 46 : 42, .065, t % 1 ? .36 : .45));
      if (full && phraseBar === 2) [1.75,3.75].forEach(t => add('hat', bar, t, 42, .05, .22));
      if (phraseBar === 3 && !halfTime && bar % 8 === 7) add('snare', bar, 2.75, 37, .1, .22);
      if ([23,31,47,55,67].includes(bar)) [3.5,3.75].forEach((t, i) => add('snare', bar, t, 40, .12, .4 + i * .1));
      if ([8,32,56].includes(bar)) add('cymbal', bar, 0, 49, 1.8, .55);
    }
  }
  notes.sort((a,b) => a.beat - b.beat);
  return { title: '雨巷来信', bpm: 96, duration: 180, sections: SECTIONS,
    bars: HARMONIES.map((chord, bar) => ({ chord, section: SECTIONS.findIndex(s => bar >= s.startBar && bar < s.startBar + s.bars) })), notes };
}
