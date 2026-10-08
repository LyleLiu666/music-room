import type { Song } from '../catalog.ts';
import type { Score } from '../music/score.ts';
import type { BeatRange } from '../audio/playback.ts';

export type ComparisonMapping = { ok: true; beat: number; range?: BeatRange; sectionId: string; name: string } | { ok: false; reason: string };
export function comparisonMapping(source: Song, target: Song, a: Score, b: Score, beat: number, range?: BeatRange): ComparisonMapping {
  const fail = (reason: string): ComparisonMapping => ({ ok: false, reason });
  if (source.workId !== target.workId) return fail('只能比较同一首歌曲的版本。');
  if (a.bpm !== b.bpm) return fail('两版速度不同，请分别试听。');
  const focus = range?.startBeat ?? beat;
  const index = a.sections.findIndex(section => focus >= section.startBar * 4 && focus < (section.startBar + section.bars) * 4);
  if (index < 0) return fail('当前位置没有可比较的段落。');
  const entry = Object.entries(source.comparisonSections).find(([, section]) => section === index);
  if (!entry || target.comparisonSections[entry[0]] === undefined) return fail('目标版本没有明确对应的段落。');
  const section = a.sections[index], other = b.sections[target.comparisonSections[entry[0]]];
  if (!other || section.bars !== other.bars) return fail('对应段落的长度不同，请分别试听。');
  const start = section.startBar * 4, end = (section.startBar + section.bars) * 4;
  if (range && (range.startBeat < start || range.endBeat > end || range.endBeat <= range.startBeat)) return fail('选区跨越段落，请选择同一段落中的小节。');
  if (beat < start || beat >= end || !Number.isFinite(beat)) return fail('播放位置已离开选区所属段落，请重新选择。');
  const offset = other.startBar * 4 - start;
  return { ok: true, beat: beat + offset, range: range && { startBeat: range.startBeat + offset, endBeat: range.endBeat + offset }, sectionId: entry[0], name: section.name };
}
