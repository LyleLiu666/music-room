import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {commandOutput} from './telemetry.ts';
import type {AssetReader} from '../render/renderer.ts';
import type {SystemMemory} from './contracts.ts';
const sourceAssets:AssetReader=path=>readFile(new URL(`../../../public/${path}`,import.meta.url));
export function parseNativeFootprint(text:string,pid:number){
 const value=JSON.parse(text);
 if(value.pid!==pid||!Number.isSafeInteger(value.bytes)||value.bytes<0)throw Error('原生内存采样结果无效');
 return value.bytes as number;
}
export function parseNativeMemory(text:string):SystemMemory{
 const value=JSON.parse(text),keys=['capacity','free','purgeable','inactive','fileBacked','compressed','wired','swapUsed','swapInBytes','swapOutBytes'] as const;
 if(!keys.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)||value.capacity<=0||keys.slice(1,7).some(key=>value[key]>value.capacity))throw Error('系统内存计数无效');
 return Object.fromEntries(keys.map(key=>[key,value[key]])) as SystemMemory;
}
/** One small verified executable per coordinator, reused for kernel counter reads. */
export function nativeFootprint(read:AssetReader=sourceAssets){
 let executable:Promise<string>|undefined,directory:string|undefined;
 const prepare=async()=>{
  const program=`footprint-darwin-${process.arch}`,manifest=JSON.parse(new TextDecoder().decode(await read('resource-native/manifest.json')));
  if(manifest.version!==2||manifest.program!==program)throw Error('内存监测程序版本无效，请重新构建');
  const bytes=await read(`resource-native/${program}`);
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.programSha256)throw Error('内存监测程序校验失败');
  directory=await mkdtemp(join(tmpdir(),'music-room-resource-native-'));const path=join(directory,'footprint');
  await writeFile(path,bytes,{mode:0o700});return path;
 };
 return {
  system:async()=>{executable??=prepare();return parseNativeMemory(await commandOutput(await executable,['system']));},
  measure:async(pid:number)=>{
   if(!Number.isSafeInteger(pid)||pid<=0)throw Error('进程身份无效');
   executable??=prepare();return parseNativeFootprint(await commandOutput(await executable,[String(pid)]),pid);
  },
  close:async()=>{await executable?.catch(()=>{});if(directory)await rm(directory,{recursive:true,force:true});}
 };
}
