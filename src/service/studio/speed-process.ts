import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {changeAudioSpeed} from './speed.ts';
import type {ResourceExecution} from '../resources/contracts.ts';
export type SpeedProcessor=(bytes:Uint8Array,rate:number,execution:ResourceExecution)=>Promise<Uint8Array>;
export function processSpeed(command=process.execPath,args=[fileURLToPath(new URL('./speed-worker-entry.ts',import.meta.url))]):SpeedProcessor{
 return async(bytes,rate,execution)=>{
  execution.signal.throwIfAborted();const directory=await mkdtemp(join(tmpdir(),'music-room-speed-'));
  try{
   const path=join(directory,'source');await writeFile(path,bytes,{mode:0o600});execution.signal.throwIfAborted();
   return await new Promise<Uint8Array>((resolve,reject)=>{
    const child=spawn(command,args,{detached:!!execution.lease,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let count=0,error='',failure:unknown,timer:ReturnType<typeof setTimeout>|undefined;
    child.stdin.on('error',()=>{});child.once('error',e=>failure=e);
    const stop=()=>{child.stdin.end();child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),1500);};
    execution.signal.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',chunk=>{count+=chunk.length;if(count>120_000_000){failure=new Error('调速输出过大');stop();}else chunks.push(chunk);});child.stderr.on('data',c=>error=(error+c).slice(-2000));
    child.once('close',code=>{if(timer)clearTimeout(timer);execution.signal.removeEventListener('abort',stop);if(execution.signal.aborted)reject(execution.signal.reason);else if(failure||code!==0||count<44)reject(failure??new Error(error||'调速处理失败'));else resolve(new Uint8Array(Buffer.concat(chunks)));});
    try{if(child.pid)execution.trackProcess(child.pid);execution.signal.throwIfAborted();child.stdin.write(JSON.stringify({path,rate,budget:execution.budgets.memory})+'\n');}catch(e){failure=e;stop();}
   });
  }finally{await rm(directory,{recursive:true,force:true});}
 };
}
export async function runSpeedWorker(){
 const lines=createInterface({input:process.stdin}),controller=new AbortController();let started=false;
 const stop=()=>controller.abort();lines.once('close',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{
  const line=await new Promise<string>((resolve,reject)=>{lines.once('line',line=>{started=true;resolve(line);});lines.once('close',()=>{if(!started)reject(new Error('调速任务缺失'));});});
  if(line.length>16384)throw new Error('调速参数无效');const task=JSON.parse(line);if(typeof task.path!=='string'||!Number.isFinite(task.budget)||task.budget<=0)throw new Error('调速参数无效');
  const output=await changeAudioSpeed(new Uint8Array(await readFile(task.path)),task.rate,controller.signal,task.budget);controller.signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>process.stdout.write(output,error=>error?reject(error):resolve()));
 }finally{lines.removeListener('close',stop);lines.close();process.stdin.destroy();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
