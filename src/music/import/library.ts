import { validateComposition, type Composition } from '../authoring/validate.mjs';
import type { Song, Work } from '../../catalog.ts';
export const STORAGE_KEY = 'music-room-imports-v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

// Only validated documents are stored; save first so quota failure cannot change the UI/library.
export class ImportedLibrary {
  documents: Composition[] = [];
  warning = '';
  private storage: StoragePort;
  private builtInWorks: Work[];
  private builtInSongs: Song[];
  constructor(storage: StoragePort, builtInWorks: Work[], builtInSongs: Song[]) {
    this.storage = storage; this.builtInWorks = builtInWorks; this.builtInSongs = builtInSongs;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const list: unknown = JSON.parse(raw);
      if (!Array.isArray(list) || list.length > 50) throw new Error('保存的作品库格式错误');
      for (const item of list) {
        try { const doc = validateComposition(JSON.stringify(item)); this.checkIdentity(doc); this.documents.push(doc); }
        catch { this.warning = '部分保存的导入作品无效，已跳过。原保存数据未覆盖，请从备份重新导入。'; }
      }
    } catch { this.warning = '无法读取本机作品库。内置作品仍可使用，请从备份重新导入。'; }
  }
  private checkIdentity(doc: Composition) {
    if (this.builtInSongs.some(s => s.id === doc.revision.id) || this.documents.some(d => d.revision.id === doc.revision.id)) throw new Error('版本 ID 已存在，请使用新的 revision.id；旧版本不会被覆盖。');
    const work = this.builtInWorks.find(w => w.id === doc.work.id) ?? this.documents.find(d => d.work.id === doc.work.id)?.work;
    if (work && work.title !== doc.work.title) throw new Error('相同 work.id 的作品标题必须一致；新歌曲请使用新的 work.id。');
  }
  add(input: Composition) {
    const doc = validateComposition(JSON.stringify(input));
    this.checkIdentity(doc);
    if (this.documents.length >= 50) throw new Error('本机最多保存 50 个导入版本，请先备份并移除不需要的版本。');
    const next = [...this.documents, doc]; this.save(next); this.documents = next;
    return doc;
  }
  remove(id: string) {
    if (!this.documents.some(d => d.revision.id === id)) throw new Error('只能移除本机导入的版本。');
    const next = this.documents.filter(d => d.revision.id !== id); this.save(next); this.documents = next;
  }
  private save(next: Composition[]) {
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('本机保存失败（存储已满或不可用）。请备份并清理浏览器存储后重试；作品库未改变。'); }
  }
  get works(): Work[] {
    const unique = new Map<string, Work>();
    for (const doc of this.documents) if (!this.builtInWorks.some(w => w.id === doc.work.id) && !unique.has(doc.work.id)) unique.set(doc.work.id, {...doc.work, defaultVersionId:doc.revision.id});
    return [...unique.values()];
  }
  get songs(): Song[] {
    return this.documents.map(doc => ({workId:doc.work.id, id:doc.revision.id, title:doc.work.title, edition:doc.revision.label,
      englishTitle:doc.revision.englishTitle, comparisonSections:doc.comparisonSections ?? {},
      summary:doc.revision.summary ?? '本机导入', description:doc.revision.description ?? '外部创作的乐谱，使用本机音色演奏。',
      key:doc.revision.key ?? '未标注调性', color:'#a8cbc4', compose:()=>doc.score,
      files:{wav:'',midi:'',score:''}}));
  }
}
