import type { Score } from '../music/score.ts';

export type BeatRange = { startBeat: number; endBeat: number };
export function validateLoop(range: BeatRange, score: Score): BeatRange {
  const { startBeat, endBeat } = range;
  if (![startBeat, endBeat].every(beat => Number.isFinite(beat) && beat % 4 === 0)
    || startBeat < 0 || endBeat <= startBeat || endBeat > score.bars.length * 4
    || endBeat * 60 / score.bpm > score.duration + 1e-8) throw new Error('循环范围必须为曲内至少一个完整小节');
  return { startBeat, endBeat };
}
export function playbackPosition(from: number, audioStart: number, now: number, duration: number, loop?: { start: number; end: number }) {
  const elapsed = Math.max(0, now - audioStart);
  if (!loop) return Math.min(duration, from + elapsed);
  const length = loop.end - loop.start;
  return loop.start + ((from - loop.start + elapsed) % length + length) % length;
}
