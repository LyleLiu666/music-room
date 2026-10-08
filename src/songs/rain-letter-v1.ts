import { TRACKS, type TrackId, type Note, type Section, type Score } from '../music/score.ts';

export const SECTIONS: Section[] = [
  { name: '引子', subtitle: '钢琴独白，主题伏笔', startBar: 0, bars: 8, color: '#899b70' },
  { name: '主题 A', subtitle: '电钢琴与摇摆节奏进入', startBar: 8, bars: 16, color: '#b29c73' },
  { name: '过渡', subtitle: '弦乐上行，属和弦蓄力', startBar: 24, bars: 8, color: '#8ca6a0' },
  { name: '副歌', subtitle: '转向 F 大调，主题展开', startBar: 32, bars: 16, color: '#cce7a4' },
  { name: '间奏', subtitle: '长笛与拨弦，节奏留白', startBar: 48, bars: 8, color: '#a4b6cc' },
  { name: '再现', subtitle: '副歌变化，旋律与应答交织', startBar: 56, bars: 12, color: '#d3b986' },
  { name: '尾声', subtitle: '回到 D 小调，钢琴落笔', startBar: 68, bars: 4, color: '#8e947f' },
];
type Harmony = { bass: number; tones: number[] };
const H: Record<string, Harmony> = {
  Dm9: { bass: 38, tones: [53, 57, 60, 64] }, 'Dm(add9)': { bass: 38, tones: [50, 57, 64, 65] },
  Gm9: { bass: 31, tones: [53, 57, 58, 62] }, C13: { bass: 36, tones: [52, 58, 62, 69] },
  Fmaj9: { bass: 29, tones: [52, 57, 60, 67] }, Bbmaj9: { bass: 34, tones: [53, 57, 60, 62] },
  Em7b5: { bass: 40, tones: [55, 58, 62, 64] }, A7b9: { bass: 33, tones: [55, 58, 61, 64] },
  Am7: { bass: 33, tones: [55, 60, 64, 69] }, Cadd9: { bass: 36, tones: [55, 60, 62, 64] },
  A7sus4: { bass: 33, tones: [55, 57, 62, 64] }, 'C/E': { bass: 40, tones: [55, 60, 64, 67] },
  'F/A': { bass: 33, tones: [53, 60, 64, 69] }, Gm7: { bass: 31, tones: [53, 58, 62, 65] },
  D7b9: { bass: 38, tones: [54, 60, 63, 69] }, Bbmaj7: { bass: 34, tones: [53, 57, 58, 62] },
  Dbmaj7: { bass: 37, tones: [53, 56, 60, 65] }, Csus4: { bass: 36, tones: [53, 58, 60, 67] },
};
const VERSE = ['Dm9', 'Gm9', 'C13', 'Fmaj9', 'Bbmaj9', 'Em7b5', 'A7sus4', 'A7b9'];
const CHORUS = ['Fmaj9', 'C/E', 'Dm9', 'Am7', 'Bbmaj9', 'F/A', 'Gm9', 'C13', 'Fmaj9', 'D7b9', 'Gm9', 'C13', 'Bbmaj9', 'Am7', 'Gm7', 'A7b9'];
const HARMONIES = [
  ...['Dm9', 'Bbmaj9', 'Fmaj9', 'Cadd9', 'Gm9', 'Em7b5', 'A7sus4', 'A7b9'],
  ...VERSE, ...VERSE,
  ...['Bbmaj7', 'Cadd9', 'Am7', 'Dm9', 'Gm9', 'Em7b5', 'A7sus4', 'A7b9'],
  ...CHORUS,
  ...['Dm9', 'Bbmaj9', 'Gm9', 'A7sus4', 'Dm9', 'Dbmaj7', 'Csus4', 'C13'],
  ...CHORUS.slice(0, 8), ...['Bbmaj9', 'Am7', 'Gm9', 'A7b9'],
  ...['Dm9', 'Bbmaj9', 'A7b9', 'Dm(add9)'],
];
// Each pair is a MIDI pitch and duration in quarter-note beats. Zero is a rest.
// Phrases are written, rather than selected from a random scale.
type Phrase = [number, number][];
const INTRO: Phrase[] = [
  [[0,.5],[69,.5],[72,.5],[74,1],[77,.5],[76,.5],[74,.5]],
  [[72,1],[69,.5],[65,.5],[67,1],[69,1]],
  [[69,.5],[72,.5],[76,1],[77,.75],[76,.25],[72,.5],[69,.5]],
  [[67,1.5],[64,.5],[67,.5],[69,.5],[72,1]],
  [[74,.75],[77,.25],[79,.5],[77,.5],[74,1],[69,1]],
  [[67,.5],[70,.5],[74,1],[76,1],[74,.5],[70,.5]],
  [[69,1],[74,1],[76,.5],[74,.5],[69,1]],
  [[73,.75],[76,.25],[79,.5],[76,.5],[73,1],[0,1]],
];
const VERSE_MELODY: Phrase[] = [
  [[0,.5],[69,.5],[72,.25],[74,.75],[72,.5],[69,.5],[65,1]],
  [[67,.75],[69,.25],[70,.5],[74,.5],[72,.75],[70,.25],[69,.5],[0,.5]],
  [[67,.5],[64,.5],[67,.5],[69,.5],[72,1.25],[70,.25],[69,.5]],
  [[69,1.5],[67,.5],[65,.5],[64,.5],[0,1]],
  [[65,.5],[69,.5],[72,.75],[74,.25],[77,1],[74,.5],[72,.5]],
  [[70,.5],[69,.5],[67,.5],[64,.5],[62,1],[64,.5],[67,.5]],
  [[69,.75],[74,.25],[76,.5],[74,.5],[69,1],[67,.5],[0,.5]],
  [[64,.5],[67,.5],[70,.5],[73,.5],[76,1],[73,.5],[0,.5]],
  [[0,.25],[69,.25],[72,.5],[74,.5],[77,.5],[76,.75],[74,.25],[72,.5],[69,.5]],
  [[70,.75],[74,.25],[77,.5],[74,.5],[72,1],[70,.5],[69,.5]],
  [[67,.25],[69,.25],[72,.5],[76,1],[74,.5],[72,.5],[69,1]],
  [[72,1.25],[69,.25],[67,.5],[65,1],[0,1]],
  [[69,.5],[72,.5],[74,.5],[77,.5],[79,.75],[77,.25],[74,.5],[72,.5]],
  [[74,.5],[76,.5],[74,.5],[70,.5],[67,.75],[64,.25],[62,1]],
  [[64,.5],[69,.5],[74,.75],[76,.25],[79,.5],[76,.5],[74,.5],[69,.5]],
  [[73,1],[76,.75],[79,.25],[81,.75],[79,.25],[76,.5],[0,.5]],
];
const PRE: Phrase[] = [
  [[77,1],[74,.5],[72,.5],[69,.5],[72,.5],[74,1]],
  [[76,.5],[79,.5],[81,1],[79,.75],[76,.25],[72,1]],
  [[76,.75],[79,.25],[81,.5],[79,.5],[76,1],[72,1]],
  [[77,1],[76,.5],[74,.5],[72,.5],[74,.5],[77,1]],
  [[79,.5],[77,.5],[74,.5],[70,.5],[74,1],[77,1]],
  [[76,.75],[74,.25],[70,.5],[67,.5],[70,1],[74,1]],
  [[76,.5],[74,.5],[69,1],[74,.5],[76,.5],[81,1]],
  [[79,.5],[76,.5],[73,.5],[76,.5],[81,1.25],[0,.75]],
];
const HOOK: Phrase[] = [
  [[0,.25],[77,.25],[79,.5],[81,1],[79,.5],[77,.5],[76,.5],[77,.5]],
  [[79,1.25],[76,.25],[74,.5],[72,1],[76,.5],[79,.5]],
  [[81,.75],[79,.25],[77,.5],[76,.5],[74,1.5],[77,.5]],
  [[76,.5],[79,.5],[81,.75],[79,.25],[76,1],[72,1]],
  [[77,.5],[79,.5],[81,.5],[84,.5],[81,1],[79,.5],[77,.5]],
  [[76,.75],[77,.25],[79,.5],[81,.5],[79,1],[77,.5],[76,.5]],
  [[74,.5],[77,.5],[79,1],[77,.5],[74,.5],[72,.5],[70,.5]],
  [[72,.75],[76,.25],[79,.5],[82,.5],[79,1],[76,.5],[0,.5]],
  [[81,1],[84,.75],[81,.25],[79,.5],[77,.5],[76,.5],[77,.5]],
  [[78,.5],[81,.5],[84,.5],[81,.5],[78,1],[75,1]],
  [[79,.75],[77,.25],[74,.5],[70,.5],[74,1],[77,1]],
  [[76,.5],[79,.5],[82,.75],[79,.25],[76,1],[72,1]],
  [[81,.75],[79,.25],[77,.5],[74,.5],[72,1],[69,.5],[72,.5]],
  [[76,1],[79,.5],[76,.5],[72,.75],[69,.25],[67,1]],
  [[70,.5],[74,.5],[77,.5],[79,.5],[77,.75],[74,.25],[70,.5],[69,.5]],
  [[73,.5],[76,.5],[79,.75],[76,.25],[73,1],[0,1]],
];
const BRIDGE: Phrase[] = [
  [[74,.5],[77,.25],[79,.25],[81,1],[79,.5],[77,.5],[74,1]],
  [[77,.75],[74,.25],[72,.5],[69,.5],[72,1],[74,1]],
  [[79,.5],[77,.5],[74,1],[70,.5],[74,.5],[77,1]],
  [[76,.5],[74,.5],[69,.75],[74,.25],[76,1],[0,1]],
  [[81,.5],[79,.25],[77,.25],[74,1],[77,.5],[79,.5],[81,1]],
  [[80,1],[77,.5],[73,.5],[72,1],[68,1]],
  [[72,.5],[77,.5],[79,1],[82,.5],[79,.5],[77,1]],
  [[76,.5],[79,.5],[82,.5],[84,.5],[82,.75],[79,.25],[76,.5],[0,.5]],
];
const OUTRO: Phrase[] = [
  [[77,1],[76,.5],[74,.5],[72,.5],[69,.5],[65,1]],
  [[69,.75],[72,.25],[74,.5],[72,.5],[69,1],[65,1]],
  [[64,.5],[67,.5],[70,.5],[73,.5],[76,1],[0,1]],
  [[74,1.4],[0,2.6]],
];
const jitter = (bar: number, i: number) => Math.sin(bar * 13.17 + i * 4.73) * .012;
const feel = (beat: number, bar: number, i: number) => Math.max(0, beat + (Math.abs(beat % .5 - .25) < .01 ? .055 : 0) + jitter(bar, i));

export function compose(): Score {
  const notes: Note[] = [];
  const add = (track: TrackId, bar: number, offset: number, pitch: number, duration: number, velocity: number, human = true) => {
    const beat = human ? feel(bar * 4 + offset, bar, notes.length % 17) : bar * 4 + offset;
    if (pitch && beat + duration < 287) notes.push({ track, pitch, beat, duration, velocity: Math.min(1, velocity) });
  };
  for (let bar = 0; bar < 72; bar++) {
    const chord = H[HARMONIES[bar]];
    const intro = bar < 8, verse = bar >= 8 && bar < 24, pre = bar >= 24 && bar < 32;
    const chorus = bar >= 32 && bar < 48, bridge = bar >= 48 && bar < 56, final = bar >= 56 && bar < 68, outro = bar >= 68;
    const strong = chorus || final;
    let phrase: Phrase;
    if (intro) phrase = INTRO[bar];
    else if (verse) phrase = VERSE_MELODY[bar - 8];
    else if (pre) phrase = PRE[bar - 24];
    else if (chorus) phrase = HOOK[bar - 32];
    else if (bridge) phrase = BRIDGE[bar - 48];
    else if (final) phrase = HOOK[bar < 64 ? bar - 56 : bar - 52];
    else phrase = OUTRO[bar - 68];
    let cursor = 0;
    phrase.forEach(([pitch, duration], i) => {
      const accent = cursor % 1 === 0 ? .065 : 0;
      add(bridge ? 'flute' : 'melody', bar, cursor, pitch, duration * .9, (strong ? .77 : pre ? .7 : .62) + accent + Math.sin(bar * 5 + i) * .045);
      // Selected octaves give the last statement weight without doubling every note.
      if (final && (i === 1 || (i === 3 && bar % 2 === 0))) add('melody', bar, cursor + .018, pitch - 12, duration * .82, .37);
      cursor += duration;
    });
    // Final downbeat: one rolled tonic voicing, then uninterrupted decay.
    if (bar === 71) {
      [chord.bass + 12, ...chord.tones, 69].forEach((p, i) => add('piano', bar, .025 * i, p, .85, .48, false));
      continue;
    }
    // Piano texture changes from broken eighths to syncopated extended voicings.
    const arps = intro || outro ? [0,.5,1,1.5,2,2.5,3,3.5] : bridge ? [0,.75,1.5,2.5,3.25] : [0,.5,1.5,2,2.75,3.5];
    arps.forEach((t, i) => {
      const p = i === 0 || i === 4 ? chord.bass + 12 : chord.tones[(i - 1 + 4) % 4] + (strong && i > 3 ? 12 : 0);
      add('piano', bar, t, p, intro ? .9 : .61, (intro || outro ? .57 : .44) + Math.sin(i * 1.3 + bar) * .06);
    });
    if (!intro && !outro) {
      const hits = strong ? [0,1.75,2.5,3.5] : pre ? [0,1.5,2.75] : bridge ? [0,2.5] : [0,.75,2.5];
      hits.forEach((t, i) => chord.tones.forEach((p, j) => add('rhodes', bar, t + j * .007, p, i === 0 ? 1.25 : .56, (strong ? .6 : .53) - j * .022)));
    }
    // Bass locks to the kick but anticipates the next harmony with a passing tone.
    if (!outro && (bar >= 8 || bar >= 6)) {
      const pattern: [number, number, number][] = strong ? [[0,0,.7],[.75,12,.3],[1.5,0,.45],[2,7,.65],[2.75,12,.3],[3.5,0,.28]] : [[0,0,1.1],[1.75,7,.5],[2.5,12,.65],[3.5,0,.3]];
      pattern.forEach(([t, interval, d], i) => add('bass', bar, t, chord.bass + interval, d, .75 - i * .025));
      if (bar % 2 === 1) {
        const next = H[HARMONIES[bar + 1]].bass;
        add('bass', bar, 3.8, next + (next >= chord.bass ? -1 : 1), .16, .5);
      }
    }
    // Pentatonic plucked answers, sparse in the verse and active in the bridge.
    if (bridge || strong || (verse && bar % 2 === 1) || (intro && bar >= 4)) {
      const times = bridge ? [.25,.75,1.25,1.75,2.25,2.75,3.25,3.75] : strong ? [.5,1.25,2.5,3.25] : [2.5,3,3.5];
      times.forEach((t, i) => add('pluck', bar, t, chord.tones[(i + bar) % 4] + 12, .37, bridge ? .56 : .37));
      if (bridge && bar % 2 === 0) [0,.09,.18,.27].forEach((t, i) => add('pluck', bar, t, chord.tones[i] + 12, .65, .5));
    }
    // Inner string voices move by the nearest available inversion, rather than jump as a block.
    if (pre || strong || (verse && bar >= 20) || (bridge && bar >= 52)) {
      const previous = bar ? H[HARMONIES[bar - 1]].tones : chord.tones;
      chord.tones.slice(0, 3).forEach((p, i) => {
        const choices = [p, p + 12, p - 12].filter(x => x >= 53 && x <= 79);
        const target = previous[i] + (i === 2 ? 12 : 0);
        const voice = choices.reduce((a, b) => Math.abs(a - target) < Math.abs(b - target) ? a : b);
        add('strings', bar, .045 * i, voice, 3.68, strong ? .64 : pre ? .43 + (bar - 24) * .025 : .4);
      });
    }
    if (strong && bar % 4 === 3) {
      [chord.tones[2] + 12, chord.tones[1] + 12, chord.tones[0] + 12].forEach((p, i) => add('flute', bar, 2.5 + i * .5, p, .42, .33));
    }
    // Drums: swung sixteenths, ghost notes, fills, and a half-time bridge.
    if (bar >= 8 && !outro || bar >= 6 && intro) {
      const halfTime = bridge && bar < 52;
      const kicks = halfTime ? [0,2.75] : strong ? [0,.75,1.5,2,2.75,3.5] : [0,1.5,2.5,3.25];
      kicks.forEach((t, i) => add('kick', bar, t, 36, .15, i === 0 ? .88 : .67));
      (halfTime ? [2] : [1,3]).forEach(t => add('snare', bar, t + .025, 38, .2, strong ? .8 : .63));
      if (bar % 2 === 1 && !halfTime) [2.75,3.75].forEach(t => add('snare', bar, t, 37, .12, .2));
      const step = strong || pre ? .25 : .5;
      for (let t = 0, i = 0; t < 4; t += step, i++) {
        const open = (strong || pre) && t === 3.5 && bar % 2 === 1;
        add('hat', bar, t, open ? 46 : 42, open ? .36 : .06, t % 1 === 0 ? .57 : t % .5 === 0 ? .43 : .23 + (bar % 3) * .04);
      }
      if ((bar === 23 || bar === 31 || bar === 47 || bar === 55 || bar === 67)) {
        [3.25,3.5,3.75,3.875].forEach((t, i) => add('snare', bar, t, i >= 2 ? 40 : 38, .11, .36 + i * .11));
      }
      if ([8,24,32,40,56,64].includes(bar)) add('cymbal', bar, 0, 49, 2, .62);
    }
  }
  notes.sort((a, b) => a.beat - b.beat);
  return { title: '雨巷来信', bpm: 96, duration: 180, sections: SECTIONS,
    bars: HARMONIES.map((chord, bar) => ({ chord, section: SECTIONS.findIndex(s => bar >= s.startBar && bar < s.startBar + s.bars) })), notes };
}
