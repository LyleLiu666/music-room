import type { Score } from './music/score.ts';
import { compose as firstEdition } from './songs/rain-letter-v1.ts';
import { compose as riffEdition } from './songs/rain-letter-v2.ts';

export type Song = {
  workId: string; comparisonSections: Record<string, number>;
  id: string; title: string; englishTitle?: string; edition: string; summary: string; description: string;
  key: string; color: string; compose: () => Score;
  files: { wav: string; midi: string; score: string };
};
const files = (id: string) => ({ wav: `exports/${id}/song.wav`, midi: `exports/${id}/song.mid`, score: `exports/${id}/score.json` });
export type Work = { id: string; title: string; defaultVersionId: string };
export const WORKS: Work[] = [{ id: 'rain-letter', title: '雨巷来信', defaultVersionId: 'rain-letter-v1' }];
const sections = { intro: 0, theme: 1, transition: 2, chorus: 3, bridge: 4, reprise: 5, outro: 6 };
// The registry is the only entry point for adding an independent composition.
// Versions can share a title while retaining separate identity and artifacts.
export const SONGS: Song[] = [
  {
    workId: 'rain-letter', comparisonSections: { ...sections },
    id: 'rain-letter-v1', title: '雨巷来信', englishTitle: 'Rain Letter', edition: '第一版',
    summary: '钢琴器乐 · 轻爵士色彩',
    description: '保留最初版本。钢琴短句、丰富和声与长笛间奏，带一些配乐色彩。',
    key: 'D 小调 → F 大调 → D 小调', color: '#a8b99a', compose: firstEdition, files: files('rain-letter-v1'),
  },
  {
    workId: 'rain-letter', comparisonSections: { ...sections },
    id: 'rain-letter-v2', title: '雨巷来信', englishTitle: 'Rain Letter', edition: '第二版 · Riff',
    summary: '钢琴流行 · 主题、回答与再现',
    description: '两小节钢琴 riff 贯穿全曲。主题反复出现，用回答句、留白和配器变化推进。',
    key: 'D 小调 → F 大调 → D 小调', color: '#cce7a4', compose: riffEdition, files: files('rain-letter-v2'),
  },
];
export const songById = (id: string) => SONGS.find(song => song.id === id);
export const versionsOf = (workId: string, songs: Song[] = SONGS) => songs.filter(song => song.workId === workId);

export function validateCatalog(works: Work[], songs: Song[]) {
  const unique = (values: string[], label: string) => {
    if (values.some(value => !value) || new Set(values).size !== values.length) throw new Error(`${label}必须非空且唯一`);
  };
  unique(works.map(work => work.id), '歌曲 ID');
  unique(songs.map(song => song.id), '版本 ID');
  unique(songs.flatMap(song => Object.values(song.files)), '导出路径');
  for (const work of works) {
    if (!songs.some(song => song.id === work.defaultVersionId && song.workId === work.id)) throw new Error('歌曲默认版本无效');
  }
  for (const song of songs) {
    if (!works.some(work => work.id === song.workId)) throw new Error('版本所属歌曲不存在');
    const score = song.compose();
    const indices = Object.values(song.comparisonSections);
    if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= score.sections.length)
      || new Set(indices).size !== indices.length) throw new Error('版本段落对应关系无效');
  }
}
validateCatalog(WORKS, SONGS);
