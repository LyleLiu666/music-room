import {signalWorkload} from '../resources/processes.ts';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join,isAbsolute} from 'node:path';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {z} from 'zod';
import {modelSetup,inferScript,referenceSetup} from './python.ts';
import {emotionStrengths} from './emotion.ts';
import {cleanReferenceScript} from './reference-python.ts';
import {ResourceLease} from '../resources/lease.ts';
const task=z.object({directory:z.string().refine(isAbsolute),owner:z.string().min(1),resourceLease:z.object({directory:z.string().refine(isAbsolute),owner:z.string().uuid()}).strict().optional(),step:z.enum(['dependencies','models','reference','infer','reference-venv','reference-dependencies','clean-reference']),request:z.object({seed:z.number().int().min(0).max(0xffffffff).optional(),text:z.string().min(1).max(8000),emotion:z.string().max(2000).optional(),emotionStrength:z.enum(emotionStrengths).optional(),referencePath:z.string().refine(isAbsolute),outputPath:z.string().refine(isAbsolute),conditioningPath:z.string().refine(isAbsolute).optional(),conditioningSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().optional(),referenceRequest:z.object({referencePath:z.string().refine(isAbsolute),outputPath:z.string().refine(isAbsolute)}).strict().optional()}).strict();
export type SpeechTask=Omit<z.infer<typeof task>,'owner'>;
export function speechEnvironment(root:string):NodeJS.ProcessEnv {
 const env:NodeJS.ProcessEnv={};for(const name of ['HOME','USER','LOGNAME','LANG','LC_ALL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR'])if(process.env[name])env[name]=process.env[name];
 // PyTorch's unified-memory defaults (low 1.4 / high 1.7) allow caches to
 // exceed Metal's recommended working set. Reclaim earlier and keep the hard
 // allocation limit at that recommendation; these are GPU limits, not a cap
 // on the process footprint or its CPU-side graph cache.
 return Object.assign(env,{PATH:`${join(root,'.venv','bin')}:${join(root,'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,MUSIC_ROOM_TTS_DIRECTORY:root,UV_NO_CONFIG:'1',UV_PROJECT_ENVIRONMENT:join(root,'.venv'),UV_PYTHON_INSTALL_DIR:join(root,'python'),UV_CACHE_DIR:join(root,'cache','uv'),HF_HOME:join(root,'cache','huggingface'),HF_HUB_CACHE:join(root,'source','checkpoints','hf_cache'),HF_HUB_DISABLE_XET:'1',HF_HUB_DOWNLOAD_TIMEOUT:'120',TORCH_HOME:join(root,'cache','torch'),NLTK_DATA:join(root,'cache','nltk'),NUMBA_CACHE_DIR:join(root,'cache','numba'),MPLCONFIGDIR:join(root,'cache','matplotlib'),PYTHONPYCACHEPREFIX:join(root,'cache','pycache'),TMPDIR:join(root,'tmp'),PYTHONUNBUFFERED:'1',PYTORCH_ENABLE_MPS_FALLBACK:'1',PYTORCH_MPS_LOW_WATERMARK_RATIO:'0.5',PYTORCH_MPS_HIGH_WATERMARK_RATIO:'1.0'});
}
/** The supervisor keeps a stdin lease; losing the application kills its Python/uv process group. */
export async function runSpeechWorker(){
 const lines=createInterface({input:process.stdin});await new Promise<void>((resolve,reject)=>{
  let started=false;
  lines.once('line',line=>{try{if(line.length>80000)throw new Error('语音任务参数过大');const t=task.parse(JSON.parse(line));const marker=join(t.directory,'.music-room-indextts.json'),lock=join(t.directory,'.music-room-indextts.lock');if(!existsSync(marker)||JSON.parse(readFileSync(marker,'utf8')).format!=='music-room-indextts'||!existsSync(lock)||JSON.parse(readFileSync(lock,'utf8')).owner!==t.owner)throw new Error('语音环境不属于当前 Music Room 任务');const env=speechEnvironment(t.directory);mkdirSync(env.TMPDIR!,{recursive:true});const command=t.step==='dependencies'?join(t.directory,'bin','uv'):join(t.directory,'.venv','bin','python'),args=t.step==='dependencies'?['sync','--frozen','--managed-python','--python','3.11','--no-dev']:['-c',t.step==='models'?modelSetup:t.step==='reference'?referenceSetup:inferScript];if(t.step==='infer'){if(!t.request)throw new Error('缺少语音生成输入');env.HF_HUB_OFFLINE='1';env.TRANSFORMERS_OFFLINE='1';}
   let runCommand=command,runArgs=args;
   const referenceRoot=join(t.directory,'reference-cleanup'),referencePython=join(referenceRoot,'.venv','bin','python');
   if(t.step==='reference-venv'){runCommand=join(t.directory,'bin','uv');runArgs=['venv','--managed-python','--python','3.11',join(referenceRoot,'.venv')];}
   if(t.step==='reference-dependencies'){runCommand=join(t.directory,'bin','uv');runArgs=['pip','sync','--python',referencePython,join(referenceRoot,'requirements.txt')];}
   if(t.step==='clean-reference'){if(!t.referenceRequest)throw new Error('缺少参考音频输入');runCommand=referencePython;runArgs=['-c',cleanReferenceScript];}
   const child=spawn(runCommand,runArgs,{cwd:join(t.directory,'source'),env,detached:!t.resourceLease,stdio:['pipe','inherit','inherit']});started=true;child.stdin.on('error',()=>{});child.stdin.end(t.referenceRequest?JSON.stringify(t.referenceRequest)+'\n':t.request?JSON.stringify(t.request)+'\n':'');let ending=false,timer:ReturnType<typeof setTimeout>|undefined;
   const stop=()=>{if(ending)return;ending=true;try{signalWorkload(child.pid,!!t.resourceLease,'SIGTERM');}catch{}timer=setTimeout(()=>{try{signalWorkload(child.pid,!!t.resourceLease,'SIGKILL');}catch{}},5000);timer.unref();};lines.once('close',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);child.once('error',reject);child.once('close',code=>{try{signalWorkload(child.pid,!!t.resourceLease,'SIGKILL');}catch{}if(timer)clearTimeout(timer);lines.removeListener('close',stop);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);lines.close();process.stdin.destroy();process.exitCode=code??1;resolve();});try{if(child.pid)ResourceLease.trackWorker(t.resourceLease,child.pid);}catch(error){stop();reject(error);}
  }catch(error){lines.close();process.stdin.destroy();reject(error);}});
  lines.once('close',()=>{if(!started)reject(new Error('未收到语音任务'));});
 });
}
