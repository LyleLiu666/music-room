// Shared by the standalone CLI and Music Room. No packages, browser or project source required.
export const TRACK_IDS = ['melody','piano','rhodes','pluck','flute','strings','bass','kick','snare','hat','cymbal'];
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '应为对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '不支持的字段');
}
function text(value, path, max = 200, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(path, `应为${empty ? '可为空的' : '非空'}文本，最多 ${max} 字符`);
}
function number(value, path, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `应为 ${min}—${max} 范围内的${integer ? '整数' : '有限数值'}`);
}
function id(value, path) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) fail(path, '使用小写英文字母开头的字母、数字、短横线，最长 64 字符');
}
function array(value, path, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `应为数组，包含 ${min}—${max} 项`);
}
function color(value, path) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(path, '使用 #RRGGBB 十六进制颜色');
}
export function validateComposition(source) {
  if (typeof source !== 'string') fail('JSON', '请传入 JSON 文本');
  if (new TextEncoder().encode(source).length > MAX_FILE_BYTES) fail('JSON', '文件超过 4 MiB');
  let doc;
  try { doc = JSON.parse(source); } catch { fail('JSON', '语法错误，请检查逗号、引号和括号'); }
  object(doc, 'root', ['format','version','work','revision','comparisonSections','score']);
  if (doc.format !== 'music-room-score') fail('format', '应为 music-room-score');
  if (doc.version !== 1) fail('version', '当前只支持格式版本 1');
  object(doc.work, 'work', ['id','title']); id(doc.work.id, 'work.id'); text(doc.work.title, 'work.title', 120);
  object(doc.revision, 'revision', ['id','label','summary','description','key','englishTitle']);
  id(doc.revision.id, 'revision.id'); text(doc.revision.label, 'revision.label', 120);
  for (const key of ['summary','description','key','englishTitle']) if (doc.revision[key] !== undefined) text(doc.revision[key], `revision.${key}`, key === 'description' ? 2000 : 200, true);
  const s = doc.score;
  object(s, 'score', ['title','bpm','duration','sections','bars','notes']);
  if (s.title !== doc.work.title) fail('score.title', '必须与 work.title 相同');
  number(s.bpm, 'score.bpm', 40, 240);
  array(s.bars, 'score.bars', 1, 512);
  const duration = s.bars.length * 4 * 60 / s.bpm;
  number(s.duration, 'score.duration', .01, 600);
  if (Math.abs(s.duration - duration) > .000001) fail('score.duration', '应为小节数 × 4 × 60 ÷ bpm（秒）');
  array(s.sections, 'score.sections', 1, s.bars.length);
  let nextBar = 0;
  s.sections.forEach((section, i) => {
    const p = `score.sections[${i}]`;
    object(section, p, ['name','midiName','subtitle','startBar','bars','color']);
    text(section.name, `${p}.name`, 120); text(section.subtitle, `${p}.subtitle`, 500, true);
    if (section.midiName !== undefined) text(section.midiName, `${p}.midiName`, 120, true);
    number(section.startBar, `${p}.startBar`, 0, s.bars.length - 1, true);
    number(section.bars, `${p}.bars`, 1, s.bars.length, true);
    if (section.startBar !== nextBar) fail(`${p}.startBar`, '段落应按顺序连续覆盖，从第 0 小节开始');
    nextBar += section.bars;
    color(section.color, `${p}.color`);
  });
  if (nextBar !== s.bars.length) fail('score.sections', '所有段落必须恰好覆盖全部小节');
  s.bars.forEach((bar, i) => {
    const p = `score.bars[${i}]`;
    object(bar, p, ['chord','section']); text(bar.chord, `${p}.chord`, 40, true);
    number(bar.section, `${p}.section`, 0, s.sections.length - 1, true);
    const section = s.sections[bar.section];
    if (i < section.startBar || i >= section.startBar + section.bars) fail(`${p}.section`, '小节不属于所指定的段落');
  });
  array(s.notes, 'score.notes', 1, 20000);
  const events = [];
  s.notes.forEach((note, i) => {
    const p = `score.notes[${i}]`;
    object(note, p, ['track','pitch','beat','duration','velocity']);
    if (!TRACK_IDS.includes(note.track)) fail(`${p}.track`, `音轨应为 ${TRACK_IDS.join(', ')}`);
    number(note.pitch, `${p}.pitch`, 0, 127, true);
    number(note.beat, `${p}.beat`, 0, s.bars.length * 4);
    number(note.duration, `${p}.duration`, .001, s.bars.length * 4);
    number(note.velocity, `${p}.velocity`, .001, 1);
    if (note.beat >= s.bars.length * 4 || note.beat + note.duration > s.bars.length * 4 + .000001) fail(p, '音符超出全曲拍数');
    events.push([note.beat, 1], [note.beat + note.duration, -1]);
  });
  events.sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  for (const [, delta] of events) { active += delta; if (active > 256) fail('score.notes', '同时持续的音符不能超过 256 个'); }
  if (doc.comparisonSections !== undefined) {
    const map = doc.comparisonSections;
    if (!map || typeof map !== 'object' || Array.isArray(map)) fail('comparisonSections', '应为共同段落 ID → 段落索引的对象');
    for (const [key,value] of Object.entries(map)) { id(key, `comparisonSections.${key}`); number(value, `comparisonSections.${key}`, 0, s.sections.length - 1, true); }
    if (new Set(Object.values(map)).size !== Object.keys(map).length) fail('comparisonSections', '同一段落不能对应多个共同 ID');
  }
  // JSON parsing makes a private copy; callers cannot mutate the input accidentally.
  s.notes.sort((a,b) => a.beat - b.beat);
  return doc;
}
