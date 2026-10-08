import type { Score, TrackId } from '../score.ts';
export type Composition = {
  format: 'music-room-score'; version: 1;
  work: { id: string; title: string };
  revision: { id: string; label: string; summary?: string; description?: string; key?: string; englishTitle?: string };
  comparisonSections?: Record<string, number>;
  score: Score;
};
export const TRACK_IDS: TrackId[];
export const MAX_FILE_BYTES: number;
export function validateComposition(source: string): Composition;
