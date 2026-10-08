import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, unlinkSync, rmSync, readdirSync, lstatSync, realpathSync, fsyncSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { validateComposition, SCORE_ID_PATTERN, type Composition } from '../../music/authoring/validate.mjs';

export class ServiceError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export function identity(value: string) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw new ServiceError('INVALID_ID','ID 必须为 1–80 个小写字母、数字或连字符');
  return value;
}
export const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export type Artifact = { id: string; path: string; mime: string; bytes: number; sha256: string; jobId: string };
export type Revision = { id: string; label: string; parentId?: string; scorePath: string; sha256: string; createdAt: string; artifacts: Artifact[] };
export type Project = { format: 'music-room-project'; version: 1; id: string; title: string; requirements: string; defaultRevisionId?: string; revisions: Revision[] };
export type Feedback = { id: string; revisionId: string; text: string; range?: {start:number;end:number}; createdAt: string };
function fail(code: string, message: string): never { throw new ServiceError(code,message); }
const alive = (pid: number) => { try { process.kill(pid,0); return true; } catch (e: any) { return e.code !== 'ESRCH'; } };
const exists = (path: string) => { try { lstatSync(path); return true; } catch (e: any) { if (e.code==='ENOENT') return false; throw e; } };

/** One owner per workspace. Files, not browser state, are the durable source of truth. */
export class ProjectStore {
  root: string;
  private owner = randomUUID();
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(root: string) { this.root = root; }
  static async open(directory: string) {
    const absolute = resolve(directory); mkdirSync(absolute,{recursive:true,mode:0o700});
    const store = new ProjectStore(realpathSync(absolute));
    const lock = join(store.root,'.music-room.lock');
    try {
      const fd = openSync(lock,'wx',0o600);
      try { writeFileSync(fd,JSON.stringify({pid:process.pid,owner:store.owner})); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error: any) {
      if (error.code!=='EEXIST') throw error;
      if (lstatSync(lock).isSymbolicLink()) fail('UNSAFE_PATH','锁文件不能是符号链接');
      let old: any;
      try { old = JSON.parse(readFileSync(lock,'utf8')); } catch { fail('WORKSPACE_LOCKED','工作目录锁损坏，请先检查原服务'); }
      if (!Number.isInteger(old.pid) || old.pid<=0 || alive(old.pid)) fail('WORKSPACE_LOCKED','工作目录正在使用，请连接已有服务');
      // Stale locks are recovered with an exclusive recovery lock, never by racing unlink/open.
      const recovery = join(store.root,'.music-room.recovery');
      let recoveryFd: number;
      try { recoveryFd = openSync(recovery,'wx',0o600); } catch { return fail('WORKSPACE_LOCKED','工作目录正在恢复锁，请稍后重试'); }
      try {
        const now = JSON.parse(readFileSync(lock,'utf8'));
        if (now.owner!==old.owner || alive(now.pid)) fail('WORKSPACE_LOCKED','工作目录正在使用');
        unlinkSync(lock); const fd = openSync(lock,'wx',0o600);
        try { writeFileSync(fd,JSON.stringify({pid:process.pid,owner:store.owner})); fsyncSync(fd); } finally { closeSync(fd); }
      } finally { closeSync(recoveryFd); unlinkSync(recovery); }
    }
    try { mkdirSync(store.path('projects'),{recursive:true}); mkdirSync(store.path('jobs'),{recursive:true}); }
    catch (error) { await store.close(); throw error; }
    return store;
  }
  path(...parts: string[]) {
    if (this.closed) fail('CLOSED','服务已关闭');
    const path = resolve(this.root,...parts), rel = relative(this.root,path);
    if (rel==='..' || rel.startsWith(`..${sep}`) || resolve(path)!==join(this.root,rel)) fail('UNSAFE_PATH','路径不能越界');
    let cursor = this.root;
    for (const part of rel.split(sep).filter(Boolean)) {
      cursor = join(cursor,part);
      if (exists(cursor) && lstatSync(cursor).isSymbolicLink()) fail('UNSAFE_PATH','项目路径不能包含符号链接');
    }
    return path;
  }
  atomicJSON(path: string, value: unknown) {
    const target = this.path(relative(this.root,path));
    const temp = `${target}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temp,'wx',0o600); writeFileSync(fd,JSON.stringify(value,null,2)); fsyncSync(fd); closeSync(fd); fd=undefined;
      this.path(relative(this.root,target)); renameSync(temp,target);
    } finally { if (fd!==undefined) closeSync(fd); if (exists(temp)) unlinkSync(temp); }
  }
  private async mutate<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.pending.then(()=> { if (this.closed) fail('CLOSED','服务已关闭'); return fn(); });
    this.pending = next.catch(()=>{}); return next;
  }
  private readProject(id: string): Project {
    const path = this.path('projects',identity(id),'project.json');
    if (!exists(path)) fail('NOT_FOUND','项目不存在');
    const p = JSON.parse(readFileSync(path,'utf8')) as Project;
    if (p.format!=='music-room-project' || p.version!==1 || p.id!==id || typeof p.title!=='string' || !Array.isArray(p.revisions)) fail('CORRUPT_PROJECT','项目清单格式不正确');
    const ids = new Set<string>();
    for (const r of p.revisions) {
      identity(r.id);
      if (ids.has(r.id) || r.scorePath!==`revisions/${r.id}/score.json` || !/^[a-f0-9]{64}$/.test(r.sha256) || !Array.isArray(r.artifacts)) fail('CORRUPT_PROJECT','版本清单格式不正确');
      if (r.parentId && !ids.has(r.parentId)) fail('CORRUPT_PROJECT','父版本不存在'); ids.add(r.id);
    }
    if (p.defaultRevisionId && !ids.has(p.defaultRevisionId)) fail('CORRUPT_PROJECT','默认版本不存在');
    return p;
  }
  async projects() { return readdirSync(this.path('projects')).filter(x=> !x.startsWith('.')).map(id=>this.readProject(id)); }
  async project(id: string) { return this.readProject(id); }
  async createProject(id: string, title: string, requirements = '') {
    return this.mutate(()=>this.create(id,title,requirements));
  }
  private create(id: string, title: string, requirements: string): Project {
    if(typeof id!=='string' || !SCORE_ID_PATTERN.test(id))fail('INVALID_ID','项目 ID 必须以小写英文字母开头，使用字母、数字或连字符，最长 64 字符');
    if (typeof title!=='string' || !title.trim() || title.length>120 || typeof requirements!=='string' || requirements.length>8000) fail('INVALID_PROJECT','项目标题或要求无效');
    const dir = this.path('projects',id);
    if (exists(dir)) fail('CONFLICT','项目 ID 已存在');
    mkdirSync(dir); mkdirSync(this.path('projects',id,'revisions'));
    const p: Project = {format:'music-room-project',version:1,id,title,requirements,revisions:[]};
    try { this.atomicJSON(this.path('projects',id,'project.json'),p); }
    catch (e) { rmSync(dir,{recursive:true,force:true}); throw e; }
    return p;
  }
  async importRevision(input: unknown, parentId?: string) {
    const doc = validateComposition(typeof input==='string' ? input : JSON.stringify(input));
    if (parentId!==undefined) identity(parentId);
    return this.mutate(async()=> {
      const all = await this.projects();
      if (all.some(p=>p.revisions.some(r=>r.id===doc.revision.id))) fail('CONFLICT','版本 ID 已存在；旧版不会覆盖');
      let p = all.find(p=>p.id===doc.work.id);
      if (p && p.title!==doc.work.title) fail('CONFLICT','相同项目 ID 的标题必须一致');
      if (parentId && !p?.revisions.some(r=>r.id===parentId)) fail('INVALID_PARENT','父版本必须属于当前项目');
      p ??= this.create(doc.work.id,doc.work.title,'');
      const dir = this.path('projects',p.id,'revisions',doc.revision.id);
      if (exists(dir)) fail('CONFLICT','版本目录已存在，请检查未完成的导入，不覆盖原件');
      mkdirSync(dir);
      const scorePath = `revisions/${doc.revision.id}/score.json`;
      const bytes = JSON.stringify(doc,null,2);
      const revision: Revision = {id:doc.revision.id,label:doc.revision.label,parentId,scorePath,sha256:hash(bytes),createdAt:new Date().toISOString(),artifacts:[]};
      try {
        const fd = openSync(this.path('projects',p.id,scorePath),'wx',0o600);
        try { writeFileSync(fd,bytes); fsyncSync(fd); } finally { closeSync(fd); }
        this.atomicJSON(this.path('projects',p.id,'project.json'),{...p,defaultRevisionId:revision.id,revisions:[...p.revisions,revision]});
      } catch (e) { rmSync(dir,{recursive:true,force:true}); throw e; }
      return revision;
    });
  }
  async revision(projectId: string, revisionId: string) {
    identity(revisionId); const p = this.readProject(projectId), metadata = p.revisions.find(r=>r.id===revisionId);
    if (!metadata) fail('NOT_FOUND','版本不存在');
    const text = readFileSync(this.path('projects',p.id,metadata.scorePath),'utf8');
    if (hash(text)!==metadata.sha256) fail('SOURCE_CHANGED','原件哈希不符，请检查外部修改');
    return {metadata,composition:validateComposition(text)};
  }
  async documents(): Promise<Composition[]> {
    const out: Composition[] = [];
    for (const p of await this.projects()) for (const r of p.revisions) out.push((await this.revision(p.id,r.id)).composition);
    return out;
  }
  async feedback(projectId: string): Promise<Feedback[]> {
    this.readProject(projectId); const path = this.path('projects',projectId,'feedback.json');
    return exists(path) ? JSON.parse(readFileSync(path,'utf8')) : [];
  }
  async addFeedback(projectId: string, revisionId: string, text: string, range?: {start:number;end:number}) {
    return this.mutate(async()=> {
      const {composition} = await this.revision(projectId,revisionId);
      if (typeof text!=='string' || !text.trim() || text.length>8000) fail('INVALID_FEEDBACK','反馈需为非空文本，最多 8000 字符');
      if (range && (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start<0 || range.end<=range.start || range.end>composition.score.duration)) fail('INVALID_RANGE','反馈时间范围无效');
      const value = {id:randomUUID(),revisionId,text,range,createdAt:new Date().toISOString()};
      this.atomicJSON(this.path('projects',projectId,'feedback.json'),[...await this.feedback(projectId),value]); return value;
    });
  }
  async publishArtifact(projectId: string, revisionId: string, jobId: string, bytes: Uint8Array) {
    identity(jobId);
    return this.mutate(async()=> {
      await this.revision(projectId,revisionId); const p = this.readProject(projectId);
      const path = `revisions/${revisionId}/${jobId}.wav`, target = this.path('projects',projectId,path);
      const a: Artifact = {id:jobId,path,mime:'audio/wav',bytes:bytes.length,sha256:hash(bytes),jobId};
      const fd = openSync(target,'wx',0o600);
      try { writeFileSync(fd,bytes); fsyncSync(fd); } catch (e) { unlinkSync(target); throw e; } finally { closeSync(fd); }
      try { this.atomicJSON(this.path('projects',projectId,'project.json'),{...p,revisions:p.revisions.map(r=>r.id===revisionId ? {...r,artifacts:[...r.artifacts,a]} : r)}); }
      catch (e) { unlinkSync(target); throw e; }
      return a;
    });
  }
  async artifact(projectId: string, revisionId: string, id: string) {
    const {metadata} = await this.revision(projectId,revisionId), a = metadata.artifacts.find(a=>a.id===identity(id));
    if (!a || a.path!==`revisions/${revisionId}/${id}.wav`) fail('NOT_FOUND','产物不存在');
    const bytes = readFileSync(this.path('projects',projectId,a.path));
    if (bytes.length!==a.bytes || hash(bytes)!==a.sha256) fail('SOURCE_CHANGED','产物原件哈希不符');
    return {metadata:a,bytes};
  }
  async close() {
    await this.pending;
    if (this.closed) return;
    const lock = this.path('.music-room.lock');
    if (exists(lock) && JSON.parse(readFileSync(lock,'utf8')).owner===this.owner) unlinkSync(lock);
    this.closed = true;
  }
}
