import type { Note, Score } from '../music/score.ts';

export const beatAtSeconds = (seconds: number, bpm: number) => seconds * bpm / 60;
export const secondsAtBeat = (beat: number, bpm: number) => beat * 60 / bpm;
export function windowAt(score: Score, start: number, size: number) {
  const startBar = Math.max(0, Math.min(score.bars.length - 1, Math.floor(start)));
  const endBar = Math.min(score.bars.length, startBar + size);
  return { startBar, endBar, startBeat: startBar * 4, endBeat: endBar * 4 };
}
export const notesInRange = (notes: Note[], start: number, end: number) => notes.filter(note => note.beat < end && note.beat + note.duration > start);
export function pitchExtent(notes: Note[]) {
  return notes.length ? { low: Math.min(...notes.map(note => note.pitch)), high: Math.max(...notes.map(note => note.pitch)) } : { low: 60, high: 72 };
}
