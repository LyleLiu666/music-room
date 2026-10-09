import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {AssetReader} from '../render/renderer.ts';
import {wavInfo,type SpeechDriver,type SpeechContext} from './speech.ts';
import {checkedDirectory,lock} from './python-runtime.ts';
import {readBuiltinVoices} from './presets.ts';
import {nativeDistribution,nativeInstalled,installNative,type NativeDistribution} from './native-install.ts';
export {nativeDistribution} from './native-install.ts';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
type Resident={root:string;child:ChildProcess;endpoint:string;modelId:string;closed:Promise<void>;exited:boolean;logs:string[];context?:SpeechContext;stopping?:Promise<void>};
export function createNativeSpeechDriver(command:string,args:string[],read?:AssetReader,options:{distribution?:NativeDistribution;cleanReference?:SpeechDriver['cleanReference']}={}):SpeechDriver{
 const distribution=options.distribution??nativeDistribution;let resident:Resident|undefined;
 async function stop(r=resident){if(!r)return;if(r.stopping)return r.stopping;r.stopping=(async()=>{r.child.stdin!.end();const timer=setTimeout(()=>r.child.kill('SIGTERM'),7000);timer.unref();try{await r.closed;}finally{clearTimeout(timer);if(resident===r)resident=undefined;}})();return r.stopping;}
 async function ready(root:string,context:SpeechContext){
  if(resident?.root===root&&!resident.exited&&!resident.stopping)return resident;
  await stop();context.signal.throwIfAborted();const lease=lock(root);let r:Resident|undefined;
  try{
   const port=await freePort(),modelId=randomUUID();context.stage('加载 audio.cpp F16 模型');
   const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});
   let finish!:()=>void;const closed=new Promise<void>(resolve=>{finish=resolve;});r={root,child,endpoint:`http://127.0.0.1:${port}`,modelId,closed,exited:false,logs:[],context};resident=r;const current=r;
   child.stdin!.on('error',()=>{});child.on('error',e=>current.logs.push(e.message));child.once('close',()=>{current.exited=true;try{lease.release();}catch(error){current.logs.push(String(error));}finally{if(resident===current)resident=undefined;finish();}});
   for(const stream of [child.stdout!,child.stderr!]){let pending='';stream.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split(/[\r\n]/);pending=lines.pop()??'';for(const line of lines){if(!line.trim())continue;current.logs.push(line);current.logs=current.logs.slice(-15);current.context?.report(line);if(line.includes('index_tts2.gpt.forward'))current.context?.stage('正在合成语音');else if(line.includes('index_tts2.qwen'))current.context?.stage('处理情绪描述');}if(pending.length>8000)pending=pending.slice(-4000);});}
   writeFileSync(lease.path,JSON.stringify({...JSON.parse(readFileSync(lease.path,'utf8')),workerPid:child.pid}));child.stdin!.write(JSON.stringify({directory:root,owner:lease.owner,port,modelId,distribution:{programSha256:distribution.programSha256,modelSha256:distribution.modelSha256,modelBytes:distribution.modelBytes}})+'\n');
   const deadline=Date.now()+120000;while(Date.now()<deadline){context.signal.throwIfAborted();if(current.exited)throw new Error(current.logs.join('\n').slice(-2500)||'audio.cpp 启动失败');try{const response=await fetch(current.endpoint+'/health',{signal:AbortSignal.timeout(500)});if(response.ok){current.context=undefined;return current;}}catch{}await delay(100);}
   throw new Error('audio.cpp 模型加载超时');
  }catch(error){if(r)await stop(r);else lease.release();throw error;}
 }
 return {engineLabel:'audio.cpp F16',installed:root=>nativeInstalled(root,distribution),builtinVoices:read?()=>readBuiltinVoices(read):undefined,close:()=>stop(),
  prepare:async(directory,context)=>{const root=checkedDirectory(directory);if(nativeInstalled(root,distribution)){if(resident&&resident.root!==root)await stop();return;}await stop();const lease=lock(root);try{await installNative(root,context,distribution);}finally{lease.release();}},
  cleanReference:options.cleanReference?async(directory,request,context)=>{await stop();await options.cleanReference!(directory,request,context);}:undefined,
  generate:async(directory,request,context)=>{
   const root=checkedDirectory(directory);if(!nativeInstalled(root,distribution))throw new Error('请先准备 audio.cpp F16 语音环境');const r=await ready(root,context);r.context=context;
   const abort=()=>{void stop(r);};context.signal.addEventListener('abort',abort,{once:true});
   try{context.signal.throwIfAborted();context.stage('正在合成语音');const emotion=request.emotion?.trim();
    const response=await fetch(r.endpoint+'/v1/audio/speech',{method:'POST',headers:{'content-type':'application/json'},signal:context.signal,body:JSON.stringify({model:r.modelId,input:request.text,voice_ref:request.referencePath,response_format:'wav',options:{num_beams:1,seed:request.seed,use_emotion_text:Boolean(emotion),emotion_text:emotion??'',emotion_alpha:emotion?0.6:1,use_random_emotion:false}})});
    if(!response.ok)throw new Error(`audio.cpp 生成失败：${(await response.text()).slice(-1800)}`);const bytes=new Uint8Array(await response.arrayBuffer());wavInfo(bytes);context.signal.throwIfAborted();context.stage('保存语音文件');writeFileSync(request.outputPath,bytes,{mode:0o600});
   }catch(error){if(context.signal.aborted||r.exited)await stop(r);throw error;}finally{r.context=undefined;context.signal.removeEventListener('abort',abort);}
  },
 };
}
