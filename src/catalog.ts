import type { Score } from './music/score.ts';
import { compose as firstEdition } from './songs/rain-letter-v1.ts';
import { compose as riffEdition } from './songs/rain-letter-v2.ts';

export type Song = {
  id: string; title: string; englishTitle?: string; edition: string; summary: string; description: string;
  key: string; color: string; compose: () => Score;
  files: { wav: string; midi: string; score: string };
};
const files = (id: string) => ({ wav: `exports/${id}/song.wav`, midi: `exports/${id}/song.mid`, score: `exports/${id}/score.json` });
// The registry is the only entry point for adding an independent composition.
// Versions can share a title while retaining separate identity and artifacts.
export const SONGS: Song[] = [
  {
    id: 'rain-letter-v1', title: '雨巷来信', englishTitle: 'Rain Letter', edition: '第一版',
    summary: '钢琴器乐 · 轻爵士色彩',
    description: '保留最初版本。钢琴短句、丰富和声与长笛间奏，带一些配乐色彩。',
    key: 'D 小调 → F 大调 → D 小调', color: '#a8b99a', compose: firstEdition, files: files('rain-letter-v1'),
  },
  {
    id: 'rain-letter-v2', title: '雨巷来信', englishTitle: 'Rain Letter', edition: '第二版 · Riff',
    summary: '钢琴流行 · 主题、回答与再现',
    description: '两小节钢琴 riff 贯穿全曲。主题反复出现，用回答句、留白和配器变化推进。',
    key: 'D 小调 → F 大调 → D 小调', color: '#cce7a4', compose: riffEdition, files: files('rain-letter-v2'),
  },
];
export const songById = (id: string) => SONGS.find(song => song.id === id);
