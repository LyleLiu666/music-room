import {signalWorkload} from '../resources/processes.ts';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {nativeInstalled,nativePaths,nativeDistribution} from './native-install.ts';
import {ResourceLease} from '../resources/lease.ts';
const task=z.object({directory:z.string().refine(isAbsolute),owner:z.string().min(1),port:z.number().int().min(1).max(65535),modelId:z.string().uuid(),resourceLease:z.object({directory:z.string().refine(isAbsolute),owner:z.string().uuid()}).strict().optional(),distribution:z.object({programSha256:z.string().regex(/^[a-f0-9]{64}$/),modelSha256:z.string().regex(/^[a-f0-9]{64}$/),modelBytes:z.number().int().positive()}).strict()}).strict();
/** The application holds stdin open for the resident engine's entire lifetime. */
export async function runNativeSpeechWorker(){
 const lines=createInterface({input:process.stdin});await new Promise<void>((resolve,reject)=>{
  let started=false;
  lines.once('line',line=>{try{
   const t=task.parse(JSON.parse(line)),lock=join(t.directory,'.music-room-indextts.lock');
   if(JSON.parse(readFileSync(join(t.directory,'.music-room-indextts.json'),'utf8')).format!=='music-room-indextts'||JSON.parse(readFileSync(lock,'utf8')).owner!==t.owner||!nativeInstalled(t.directory,{...nativeDistribution,...t.distribution}))throw new Error('常驻推理环境校验失败');
   const p=nativePaths(t.directory),configPath=join(p.base,'server.json');
   const config={host:'127.0.0.1',port:t.port,backend:'metal',threads:4,lazy_load:false,idle_unload_ms:0,max_loaded_models:1,max_request_body_bytes:65536,log_request_body:false,models:[{id:t.modelId,family:'index_tts2',path:p.model,task:'tts',mode:'offline',session_options:{'index_tts2.mem_saver':true,'index_tts2.tail_context_frames':32,'index_tts2.speaker_cache_slots':1,'index_tts2.emotion_cache_slots':1,'index_tts2.emotion_text_cache_slots':1},default_request_options:{num_beams:1}}]};
   writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
   const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:join(t.directory,'tmp')};for(const key of ['HOME','USER','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key];
   const child=spawn(p.program,['--config',configPath,'--no-ui','--log'],{cwd:join(p.base,'release'),env,detached:!t.resourceLease,stdio:['ignore','inherit','inherit']});started=true;
   writeFileSync(lock,JSON.stringify({...JSON.parse(readFileSync(lock,'utf8')),enginePid:child.pid}));
   let ending=false,timer:ReturnType<typeof setTimeout>|undefined;
   const stop=()=>{if(ending)return;ending=true;try{signalWorkload(child.pid,!!t.resourceLease,'SIGTERM');}catch{}timer=setTimeout(()=>{try{signalWorkload(child.pid,!!t.resourceLease,'SIGKILL');}catch{}},5000);timer.unref();};
   lines.once('close',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
   child.once('error',reject);child.once('close',code=>{try{signalWorkload(child.pid,!!t.resourceLease,'SIGKILL');}catch{}if(timer)clearTimeout(timer);lines.removeListener('close',stop);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);lines.close();process.stdin.destroy();process.exitCode=code??1;resolve();});
   try{if(child.pid)ResourceLease.trackWorker(t.resourceLease,child.pid);}catch(error){stop();reject(error);}
  }catch(error){lines.close();process.stdin.destroy();reject(error);}});
  lines.once('close',()=>{if(!started)reject(new Error('未收到常驻推理配置'));});
 });
}
