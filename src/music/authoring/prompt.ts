import type { Composition } from './validate.mjs';
export type AuthoringStage = 'four' | 'eight' | 'expand';
export function buildAuthoringPrompt(stage: AuthoringStage, current: Composition): string {
  const brief = stage === 'expand'
    ? `请基于附件 ${current.revision.id}.json 扩写当前项目。\n当前作品 ${JSON.stringify(current.work.title)}，${current.score.bars.length} 小节、${current.score.bpm} BPM。\n保留已经认可的主 riff，先说明它如何发展，再扩成约三分钟器乐曲。保留 ${JSON.stringify(current.work.id)} 作为 work.id，保留 work.title；使用新的 revision.id，不能复用 ${JSON.stringify(current.revision.id)}。旧版本须保留。\n优先保持速度，通过回答句、留白、和声、配器、间奏与再现推进，不要把短句简单循环到三分钟。若保留原片段供 A/B 试听，把它作为独立且等长的段落，沿用 comparisonSections 中的共同段落 ID。`
    : `请先写 ${stage === 'four' ? 4 : 8} 小节的完整乐句，固定 96 BPM、4/4，无人声。\n这次只交付这个短片段，先把主题和律动写好，再根据试听反馈扩写。建立新的 work.id 和 revision.id；同一项目后续保留 work.id，使用新的 revision.id 和版本名称。\n用两小节 riff 加回答句、长音与留白，避免零碎跑音和机械重复。以钢琴为主，可加入电钢琴、贝斯与轻鼓。`;
  return `${brief}\n\n你可以用任意语言写作曲代码，不需要 Music Room 项目源码。先阅读附带的独立创作包 README.md 和 example.json。\n优先输出 music-room-score 格式版本 1 的 song.json 和完整作曲源码。使用包内 node check.mjs song.json 校验并修复错误。\n也可输出符合说明的固定速度、4/4 MIDI；若需要项目内多版本和段落比较，务必同时交付 JSON。\n简要说明主 riff 和回答句。用户会在静态页面导入乐谱，用本机音色试听、调整混音并导出 WAV。\n若无法实际试听，明确说明未听过，格式通过不代表音乐已验收。`;
}
