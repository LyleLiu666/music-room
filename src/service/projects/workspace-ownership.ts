import {randomUUID} from 'node:crypto';
import {openSync,closeSync,readFileSync,writeFileSync,lstatSync,unlinkSync,fsyncSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {ServiceError} from './errors.ts';

export const incompleteRestoreFile='.music-room.restore-incomplete';
export function assertWorkspaceComplete(root:string){
 if(existsSync(join(root,incompleteRestoreFile)))throw new ServiceError('RESTORE_INCOMPLETE','工作目录恢复尚未完成，请保留原备份并恢复到另一个新目录');
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e:any){return e.code!=='ESRCH';}};
const fail=(message:string):never=>{throw new ServiceError('WORKSPACE_LOCKED',message);};
function readOwner(path:string){
 if(lstatSync(path).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','锁文件不能是符号链接');
 try{const record=JSON.parse(readFileSync(path,'utf8'));if(!Number.isInteger(record.pid)||record.pid<=0||typeof record.owner!=='string')return fail('工作目录锁损坏，请先检查原服务');return record as {pid:number;owner:string};}catch{return fail('工作目录锁损坏，请先检查原服务');}
}
/** Shared with backup: recovery is a short synchronous handover, never held
 * across file copying. A dead operation leaves only the normal recoverable lock. */
export function acquireWorkspace(root:string,preserveStale=false){
 assertWorkspaceComplete(root);
 const lock=join(root,'.music-room.lock'),owner=randomUUID();let previous:Buffer|undefined;
 const claim=()=>{const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,JSON.stringify({pid:process.pid,owner}));fsyncSync(fd);}finally{closeSync(fd);}};
 try{claim();}catch(e:any){
  if(e.code!=='EEXIST')throw e;
  const old=readOwner(lock);if(alive(old.pid))fail('工作目录正在使用，请连接已有服务');
  const recovery=join(root,'.music-room.recovery');let gate:number;
  try{gate=openSync(recovery,'wx',0o600);}catch{return fail('工作目录正在恢复锁，请稍后重试');}
  try{
   const current=readOwner(lock);if(current.owner!==old.owner||alive(current.pid))fail('工作目录正在使用');
   if(preserveStale)previous=readFileSync(lock);
   unlinkSync(lock);claim();
  }finally{closeSync(gate);unlinkSync(recovery);}
 }
 let released=false;
 const release=()=>{if(released)return;released=true;if(existsSync(lock)&&readOwner(lock).owner===owner){if(previous)writeFileSync(lock,previous,{mode:0o600});else unlinkSync(lock);}};
 try{assertWorkspaceComplete(root);}catch(e){release();throw e;}
 return release;
}
