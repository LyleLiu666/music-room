import {mkdirSync, openSync, closeSync, writeFileSync, readFileSync, lstatSync, unlinkSync, renameSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {groupMembers} from './processes.ts';

type Identity = {pid: number; started: string;group?:boolean};
type Record = {version: 1; owner: string; parent: Identity; workers: Identity[]};
export function processIdentity(pid: number): Identity | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('进程身份无效');
  try {
    try {process.kill(pid, 0);} catch (error: any) {if (error.code === 'ESRCH') return undefined; throw error;}
    const output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid=,stat=,lstart='], {encoding: 'utf8', timeout: 2000,env:{...process.env,LC_ALL:'C',TZ:'UTC'}}).trim();
    const [pgid,state,...date]=output.split(/\s+/);const started=date.join(' ');
    return started&&!state.startsWith('Z') ? {pid, started,group:Number(pgid)===pid} : undefined;
  } catch (error: any) {
    // ps exits 1 for an absent process. All other errors must block recovery.
    if (error.status === 1) return undefined;
    throw error;
  }
}
function same(identity: Identity) {
  const current = processIdentity(identity.pid);
  if(current?.started === identity.started)return true;
  // An exited group leader is not proof that all of its model descendants exited.
  return identity.group===true&&groupMembers(identity.pid).length>0;
}
/** A user-wide lease. Never kills stale PIDs: ambiguity blocks rather than misidentifying a process. */
export class ResourceLease {
  readonly directory: string;
  private owner: string = randomUUID();
  private record?: Record;
  private path: string;
  constructor(directory = join(homedir(), 'Library', 'Application Support', 'MusicRoom', 'resources')) {
    this.directory = directory; this.path = join(directory, 'heavy-task.json');
  }
  capability() {if (!this.record) throw new Error('没有模型执行租约'); return {directory: this.directory, owner: this.owner};}
  private read(): Record {
    if (lstatSync(this.path).isSymbolicLink()) throw new Error('资源租约不能是符号链接');
    const r = JSON.parse(readFileSync(this.path, 'utf8')) as Record;
    const valid = (i: Identity) => i && Number.isSafeInteger(i.pid) && i.pid > 0 && typeof i.started === 'string' && !!i.started;
    if (r.version !== 1 || typeof r.owner !== 'string' || !valid(r.parent) || !Array.isArray(r.workers) || !r.workers.every(valid))
      throw new Error('资源租约损坏，请查看诊断');
    return r;
  }
  private publish(r: Record) {
    const temporary = this.path + '.' + this.owner + '.partial';
    writeFileSync(temporary, JSON.stringify(r), {flag: 'wx', mode: 0o600});
    try {renameSync(temporary, this.path);} finally {if (existsSync(temporary)) unlinkSync(temporary);}
  }
  acquire(): boolean {
    mkdirSync(this.directory, {recursive: true, mode: 0o700});
    if (lstatSync(this.directory).isSymbolicLink()) throw new Error('资源租约目录不能是符号链接');
    if (this.record) {
      if (this.read().owner !== this.owner) throw new Error('资源租约所属关系已改变');
      return true;
    }
    const parent = processIdentity(process.pid); if (!parent) throw new Error('无法确认服务进程身份');
    const next: Record = {version: 1, owner: this.owner, parent, workers: []};
    let fd: number;
    try {fd = openSync(this.path, 'wx', 0o600);} catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      const previous = this.read();
      if (same(previous.parent) || previous.workers.some(same)) return false;
      const recovery = this.path + '.recovery'; let guard: number;
      try {guard = openSync(recovery, 'wx', 0o600);} catch (error: any) {if (error.code === 'EEXIST') return false; throw error;}
      try {
        const current = this.read();
        if (current.owner !== previous.owner || same(current.parent) || current.workers.some(same)) return false;
        unlinkSync(this.path); fd = openSync(this.path, 'wx', 0o600);
      } finally {closeSync(guard); unlinkSync(recovery);}
    }
    try {writeFileSync(fd!, JSON.stringify(next));} finally {closeSync(fd!);}
    this.record = next; return true;
  }
  /** Register supervisors before granting their stdin permission to launch model children. */
  track(pid: number) {
    if (!this.record || this.read().owner !== this.owner) throw new Error('没有模型执行租约');
    const worker = processIdentity(pid); if (!worker) throw new Error('所属监管进程已退出');
    const current = this.read();
    const next = {...current, workers: [...current.workers.filter(same), worker]};
    this.publish(next); this.record = next;
  }
  static trackWorker(capability: {directory: string; owner: string} | undefined, pid: number) {
    if (!capability) return;
    const lease = new ResourceLease(capability.directory); lease.owner = capability.owner;
    lease.record = lease.read(); lease.track(pid);
  }
  release() {
    if (!this.record) return;
    const current = this.read();
    if (current.owner !== this.owner) throw new Error('资源租约所属关系已改变');
    if (current.workers.some(same)) throw new Error('模型监管进程尚未退出，不能释放资源租约');
    unlinkSync(this.path); this.record = undefined;
  }
}
