export type TrackId = 'melody' | 'piano' | 'rhodes' | 'pluck' | 'flute' | 'strings' | 'bass' | 'kick' | 'snare' | 'hat' | 'cymbal';
export type Note = { track: TrackId; pitch: number; beat: number; duration: number; velocity: number };
export type Section = { name: string; midiName?: string; subtitle: string; startBar: number; bars: number; color: string };
export type Score = { title: string; bpm: number; duration: number; sections: Section[]; bars: { chord: string; section: number }[]; notes: Note[] };
export const TRACKS: { id: TrackId; name: string; description: string; gain: number; pan: number; send: number; program: number; color: string }[] = [
  { id: 'melody', name: '主旋律钢琴', description: '真实三角钢琴 · 主题与再现', gain: .77, pan: .06, send: .21, program: 0, color: '#cce7a4' },
  { id: 'piano', name: '钢琴织体', description: '分解和弦 · 流动的底色', gain: .32, pan: -.23, send: .2, program: 0, color: '#a4c58a' },
  { id: 'rhodes', name: '电钢琴', description: 'FM 合成 · 切分和弦', gain: .23, pan: .17, send: .19, program: 4, color: '#c9b78c' },
  { id: 'pluck', name: '拨弦', description: '物理建模 · 五声音阶装饰', gain: .24, pan: -.35, send: .25, program: 107, color: '#debc87' },
  { id: 'flute', name: '长笛', description: '真实采样 · 间奏与应答', gain: .6, pan: -.08, send: .25, program: 73, color: '#a8cbc4' },
  { id: 'strings', name: '弦乐组', description: '真实采样 · 渐进铺陈', gain: .2, pan: .25, send: .31, program: 48, color: '#a1b1cf' },
  { id: 'bass', name: '贝斯', description: '合成电贝斯 · 根音与经过音', gain: .47, pan: 0, send: .01, program: 33, color: '#b5a8cf' },
  { id: 'kick', name: '底鼓', description: '合成 · R&B 律动', gain: .68, pan: 0, send: .015, program: 0, color: '#cb9b9b' },
  { id: 'snare', name: '军鼓 / 拍手', description: '合成 · 后拍与轻击', gain: .28, pan: -.06, send: .13, program: 0, color: '#d4aaaa' },
  { id: 'hat', name: '踩镲', description: '合成 · 摇摆与开合', gain: .14, pan: .23, send: .035, program: 0, color: '#c9b5b1' },
  { id: 'cymbal', name: '镲片', description: '合成 · 段落标点', gain: .1, pan: -.35, send: .32, program: 0, color: '#d7c6b4' },
];
