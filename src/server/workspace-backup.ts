import {acquireWorkspace,incompleteRestoreFile,assertWorkspaceComplete} from '../service/projects/workspace-ownership.ts';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,readFile,readdir,realpath,mkdir,open,writeFile,copyFile,rm,chmod} from 'node:fs/promises';
import {dirname,join,resolve,relative,sep} from 'node:path';

export class WorkspaceBackupError extends Error {
 readonly code:string;
 constructor(code:string,message:string){super(message);this.code=code;}
}
const fail=(code:string,message:string):never=>{throw new WorkspaceBackupError(code,message);};
const runtimeFiles=['.music-room.lock','.music-room.runtime.json'];
type Entry=({path:string;type:'directory'}|{path:string;type:'file';bytes:number;sha256:string})&{mode:number};
async function stat(path:string){try{return await lstat(path);}catch(e:any){if(e.code==='ENOENT')return undefined;throw e;}}
async function directory(path:string){const s=await stat(path);if(!s?.isDirectory()||s.isSymbolicLink())fail('UNSAFE_ENTRY','目录不存在或包含符号链接');}
async function hash(path:string){const digest=createHash('sha256'),file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{for await(const chunk of file.createReadStream({autoClose:false}))digest.update(chunk);return digest.digest('hex');}finally{await file.close();}}
async function inventory(root:string,exclude:string[]=[],prefix=''):Promise<Entry[]>{
 const entries:Entry[]=[];
 for(const name of (await readdir(join(root,prefix))).sort()){
  const path=prefix?prefix+'/'+name:name,full=join(root,path),s=await lstat(full);
  if(s.isSymbolicLink()||!s.isFile()&&!s.isDirectory())fail('UNSAFE_ENTRY','工作目录包含链接或不支持的文件，请先检查');
  if(!prefix&&exclude.includes(name))continue;
  if(s.isDirectory()){entries.push({path,type:'directory',mode:s.mode&0o777});entries.push(...await inventory(root,[],path));}
  else entries.push({path,type:'file',mode:s.mode&0o777,bytes:s.size,sha256:await hash(full)});
 }
 return entries;
}
async function canonical(path:string):Promise<string>{const s=await stat(path);if(s)return realpath(path);return join(await canonical(dirname(path)),path.slice(dirname(path).length+1));}
function contains(parent:string,child:string){const r=relative(parent,child);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep);}
async function destination(source:string,target:string){
 const existing=await stat(target);if(existing?.isSymbolicLink())fail('DESTINATION_EXISTS','目标已存在，请选择一个新目录');
 const actual=await canonical(target);
 if(contains(source,actual)||contains(actual,source))fail('UNSAFE_PATH','备份与恢复目录必须独立于来源目录');
 if(await stat(target))fail('DESTINATION_EXISTS','目标已存在，请选择一个新目录');
 await directory(dirname(target));
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e:any){if(e.code==='ESRCH')return false;return true;}}
async function stopped(root:string){
 if(await stat(join(root,'.music-room.recovery')))fail('WORKSPACE_STATE_UNSAFE','工作目录正在恢复，请先检查服务状态');
 for(const name of runtimeFiles){
  const file=join(root,name),s=await stat(file);if(!s)continue;
  if(!s.isFile()||s.isSymbolicLink())fail('UNSAFE_ENTRY','运行标记不是普通文件');
  let record:any;try{record=JSON.parse(await readFile(file,'utf8'));}catch{fail('WORKSPACE_STATE_UNSAFE','运行标记损坏，请先检查服务状态');}
  if(!Number.isSafeInteger(record?.pid)||record.pid<=0)fail('WORKSPACE_STATE_UNSAFE','无法确认服务已停止');
  if(alive(record.pid))fail('WORKSPACE_RUNNING','请先停止服务，再备份作品');
 }
}
async function copyEntries(source:string,target:string,entries:Entry[],exists=false){
 if(!exists)await mkdir(target,{mode:0o700});
 for(const entry of entries){const path=join(target,entry.path);if(entry.type==='directory')await mkdir(path,{mode:0o700});else {await copyFile(join(source,entry.path),path,constants.COPYFILE_EXCL);await chmod(path,0o600);const fd=await open(path,'r+');try{await fd.chmod(entry.mode);await fd.sync();}finally{await fd.close();}}}
 for(const entry of [...entries].reverse())if(entry.type==='directory')await chmod(join(target,entry.path),entry.mode);
}
function result(root:string,entries:Entry[]){return {backupDirectory:root,workspaceDirectory:join(root,'workspace'),manifestPath:join(root,'manifest.json'),fileCount:entries.filter(e=>e.type==='file').length,totalBytes:entries.reduce((n,e)=>n+(e.type==='file'?e.bytes:0),0)};}
export async function verifyWorkspaceBackup(directoryPath:string){
 const root=resolve(directoryPath);await directory(root);await directory(join(root,'workspace'));
 const manifestPath=join(root,'manifest.json');const s=await stat(manifestPath);if(!s?.isFile()||s.isSymbolicLink()||s.size>64*1024*1024)fail('INVALID_BACKUP','备份缺少有效清单');
 let manifest:any;try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{fail('INVALID_BACKUP','备份清单损坏');}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||Object.keys(manifest).sort().join(',')!=='entries,excludedRuntimeFiles,format,version'||manifest.format!=='music-room-workspace-backup'||manifest.version!==1||!Array.isArray(manifest.excludedRuntimeFiles)||manifest.excludedRuntimeFiles.some((x:unknown)=>typeof x!=='string'||!runtimeFiles.includes(x))||!Array.isArray(manifest.entries))fail('INVALID_BACKUP','备份清单格式不支持');
 const entries=await inventory(join(root,'workspace'));
 if(JSON.stringify(entries)!==JSON.stringify(manifest.entries))fail('BACKUP_CHANGED','备份校验失败：文件缺失、增加或内容变化');
 return result(root,entries);
}
export async function createWorkspaceBackup(options:{sourceDirectory:string;destinationDirectory:string}){
 const source=resolve(options.sourceDirectory),target=resolve(options.destinationDirectory);await directory(source);const actual=await realpath(source);await destination(actual,target);await stopped(actual);
 assertWorkspaceComplete(actual);
 let release:()=>void;try{release=acquireWorkspace(actual,true);}catch(e:any){throw new WorkspaceBackupError(e.code==='WORKSPACE_LOCKED'?'WORKSPACE_RUNNING':e.code,e.message);}
 let created=false;
 try{
  const excludedRuntimeFiles=[];for(const name of runtimeFiles)if(name!=='.music-room.lock'&&await stat(join(actual,name)))excludedRuntimeFiles.push(name);
  // The lock is deliberately always recorded as excluded, including our temporary ownership.
  excludedRuntimeFiles.unshift('.music-room.lock');
  const entries=await inventory(actual,[...runtimeFiles,'.music-room.recovery']);
  try{await mkdir(target,{mode:0o700});created=true;}catch(e:any){if(e.code==='EEXIST')fail('DESTINATION_EXISTS','目标已存在');throw e;}
  await copyEntries(actual,join(target,'workspace'),entries);
  const copied=await inventory(join(target,'workspace'));if(JSON.stringify(copied)!==JSON.stringify(entries)||JSON.stringify(await inventory(actual,[...runtimeFiles,'.music-room.recovery']))!==JSON.stringify(entries))fail('SOURCE_CHANGED','备份期间源文件发生变化，请停止其他写入后重试');
  const fd=await open(join(target,'manifest.json'),'wx',0o600);try{await fd.writeFile(JSON.stringify({format:'music-room-workspace-backup',version:1,excludedRuntimeFiles,entries},null,2));await fd.sync();}finally{await fd.close();}
  return await verifyWorkspaceBackup(target);
 }catch(e){if(created)await rm(target,{recursive:true,force:true});throw e;}finally{await release();}
}
export async function restoreWorkspaceBackup(options:{backupDirectory:string;destinationDirectory:string}){
 const verified=await verifyWorkspaceBackup(options.backupDirectory),target=resolve(options.destinationDirectory);
 await destination(await realpath(verified.backupDirectory),target);
 const entries=await inventory(verified.workspaceDirectory);let created=false;
 try{
  // copyEntries uses exclusive mkdir; never remove a destination owned by another caller.
  await mkdir(target,{mode:0o700});created=true;
  const marker=join(target,incompleteRestoreFile);const receipt=await open(marker,'wx',0o600);try{await receipt.writeFile(JSON.stringify({format:'music-room-restore',version:1}));await receipt.sync();}finally{await receipt.close();}

  await copyEntries(verified.workspaceDirectory,target,entries,true);
  if(JSON.stringify(await inventory(target,[incompleteRestoreFile]))!==JSON.stringify(entries))fail('BACKUP_CHANGED','恢复校验失败');
  await verifyWorkspaceBackup(verified.backupDirectory);
  await rm(marker);
  return {workspaceDirectory:target,fileCount:verified.fileCount,totalBytes:verified.totalBytes};
 }catch(e){if(created)await rm(target,{recursive:true,force:true});throw e;}
}
