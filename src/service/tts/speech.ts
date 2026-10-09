import {mkdirSync,existsSync,readFileSync,writeFileSync,unlinkSync,renameSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ProjectStore,ServiceError,hash,identity} from '../projects/store.ts';
export type SpeechContext={signal:AbortSignal;report:(message:string)=>void;stage:(message:string)=>void};
export type SpeechRequest={text:string;emotion?:string;referencePath:string;outputPath:string};
export type ReferenceRequest={referencePath:string;outputPath:string};
export type VoiceProcessing={state:'queued'|'running'|'succeeded'|'failed'|'interrupted';stage:string;error?:string;sourceSha256:string;pipeline?:string};
export type BuiltinVoice={id:string;name:string;audio:Uint8Array};
export type SpeechDriver={engineLabel?:string;close?:()=>Promise<void>;builtinVoices?:()=>Promise<BuiltinVoice[]>;cleanReference?:(directory:string,request:ReferenceRequest,context:SpeechContext)=>Promise<void>;exampleVoice?:(directory:string)=>Uint8Array|undefined;installed:(directory:string)=>boolean;prepare:(directory:string,context:SpeechContext)=>Promise<void>;generate:(directory:string,request:SpeechRequest,context:SpeechContext)=>Promise<void>};
export type SpeechVoice={id:string;name:string;duration:number;sha256:string;createdAt:string;builtinId?:string;favorite?:boolean;sourceVoiceId?:string;processing?:VoiceProcessing};
export type SpeechSound={id:string;projectId:string;title:string;finalVersionId?:string;createdAt:string};
export type SpeechVersion={id:string;projectId:string;soundId:string;number:number;parentId?:string;voiceId:string;voiceName:string;text:string;emotion?:string;engine:'IndexTTS 2.0';backend?:string;state:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';stage:string;createdAt:string;kept:boolean;deleted:boolean;error?:string;artifact?:{sha256:string;bytes:number;duration:number;sampleRate:number;peak:number}};
export type SpeechGenerate={soundId:string;voiceId:string;text:string;emotion?:string;parentId?:string};
export type SpeechStatus={engine:'IndexTTS 2.0';backend?:string;phase:'uninstalled'|'preparing'|'ready'|'failed';canGenerate:boolean;directory:string;message:string;logs:string[]};
type Data={format:'music-room-speech';version:1;directory?:string;voices:SpeechVoice[];sounds:SpeechSound[];versions:SpeechVersion[]};
const copy=<T>(value:T):T=>structuredClone(value);
const required=(s:string,max:number)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw new ServiceError('INVALID_REQUEST',`请填写内容（最多 ${max} 字）`);return s.trim();};
export function wavInfo(bytes:Uint8Array){
 const b=Buffer.from(bytes);if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)throw new ServiceError('INVALID_AUDIO','请上传完整的 PCM WAV 音频');
 let channels=0,sampleRate=0,block=0,data:Buffer|undefined;
 for(let offset=12;offset+8<=b.length;){const size=b.readUInt32LE(offset+4),end=offset+8+size;if(end>b.length)throw new ServiceError('INVALID_AUDIO','WAV 数据不完整');const tag=b.toString('ascii',offset,offset+4);if(tag==='fmt '){if(size<16||b.readUInt16LE(offset+8)!==1||b.readUInt16LE(offset+22)!==16)throw new ServiceError('INVALID_AUDIO','需要 16 位 PCM WAV 音频');channels=b.readUInt16LE(offset+10);sampleRate=b.readUInt32LE(offset+12);block=b.readUInt16LE(offset+20);}if(tag==='data')data=b.subarray(offset+8,end);offset=end+(size%2);}
 if(!data?.length||![1,2].includes(channels)||sampleRate<8000||sampleRate>96000||block!==channels*2||data.length%block!==0)throw new ServiceError('INVALID_AUDIO','WAV 声道或采样率无效');let peak=0;for(let i=0;i<data.length;i+=2)peak=Math.max(peak,Math.abs(data.readInt16LE(i)/32768));return {duration:data.length/(block*sampleRate),sampleRate,peak};
}
export class SpeechService {
 private store:ProjectStore;private driver:SpeechDriver;private data:Data;private phase:SpeechStatus['phase']='uninstalled';private message='首次使用请准备 IndexTTS 2.0';private logs:string[]=[];private closing=false;
 private preparation?:{controller:AbortController;done:Promise<void>};private active?:{id:string;kind:'voice'|'speech';controller:AbortController;done:Promise<void>};
 private constructor(store:ProjectStore,driver:SpeechDriver,data:Data){this.store=store;this.driver=driver;this.data=data;}
 static async open(store:ProjectStore,driver:SpeechDriver){
  mkdirSync(store.path('speech','voices'),{recursive:true,mode:0o700});mkdirSync(store.path('speech','audio'),{recursive:true,mode:0o700});
  const path=store.path('speech','library.json'),data:Data=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{format:'music-room-speech',version:1,voices:[],sounds:[],versions:[]};
  if(data.format!=='music-room-speech'||data.version!==1||!Array.isArray(data.voices)||!Array.isArray(data.sounds)||!Array.isArray(data.versions))throw new ServiceError('CORRUPT_SPEECH','语音项目文件格式无效');
  const service=new SpeechService(store,driver,data);for(const v of data.versions){identity(v.id);if(['queued','running'].includes(v.state)){v.state='interrupted';v.stage='服务上次已停止，可重新生成';}if(v.state==='succeeded'){try{service.audio(v.id,true);}catch{v.state='failed';v.error='已保存音频缺失或发生外部修改，请重新生成';v.artifact=undefined;}}}
  for(const voice of data.voices){identity(voice.id);if(voice.processing&&['queued','running'].includes(voice.processing.state)){voice.processing.state='interrupted';voice.processing.stage='清理已中断，可以重试';}}
  for(const s of data.sounds)if(s.finalVersionId&&!data.versions.some(v=>v.id===s.finalVersionId&&!v.deleted&&v.state==='succeeded'))s.finalVersionId=undefined;
  service.persist();await service.seedBuiltins();if(driver.installed(service.directory())){service.phase='ready';service.message='IndexTTS 2.0'+(driver.engineLabel?' · '+driver.engineLabel:'')+' 已准备好';service.seedExample();}return service;
 }
 private async seedBuiltins(){
  const presets=await this.driver.builtinVoices?.()??[];
  for(const preset of presets){
   if(this.data.voices.some(v=>v.builtinId===preset.id))continue;
   const matching=this.data.voices.find(v=>v.sha256===hash(preset.audio)&&(!v.processing||v.processing.state==='succeeded'));
   const voice=matching??this.addVoice(preset.name,preset.audio);
   this.voiceAudio(voice.id);
   this.change(()=>{this.voice(voice.id).builtinId=preset.id;});
  }
 }
 private seedExample(){if(this.data.voices.length)return;const bytes=this.driver.exampleVoice?.(this.directory());if(bytes)this.addVoice('示例声音 · 官方样音',bytes);}
 private directory(){return this.data.directory??join(homedir(),'Music','IndexTTS2');}
 private persist(){this.store.atomicJSON(this.store.path('speech','library.json'),this.data);}
 private change<T>(fn:()=>T):T{const before=copy(this.data);try{const result=fn();this.persist();return copy(result);}catch(error){this.data=before;throw error;}}
 private check(){if(this.closing)throw new ServiceError('CLOSED','语音服务正在退出');}
 private report=(message:string)=>{const clean=message.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').trim().slice(-1000);if(clean){this.logs.push(clean);this.logs=this.logs.slice(-60);}};
 status():SpeechStatus{return {engine:'IndexTTS 2.0',backend:this.driver.engineLabel,phase:this.phase,canGenerate:!this.closing&&this.phase==='ready',directory:this.directory(),message:this.message,logs:[...this.logs]};}
 snapshot(){return {voices:copy(this.data.voices),sounds:copy(this.data.sounds),versions:copy(this.data.versions),status:this.status()};}
 async prepare(directory=this.directory()){
  this.check();if(this.preparation)throw new ServiceError('SPEECH_BUSY','正在准备语音环境，请等待');if(this.active)throw new ServiceError('SPEECH_BUSY','语音正在生成，请完成后再准备环境');
  this.change(()=>{this.data.directory=directory;});this.phase='preparing';this.message='正在准备运行环境和模型';const controller=new AbortController(),active={controller,done:Promise.resolve()};this.preparation=active;
  active.done=Promise.resolve().then(()=>this.driver.prepare(directory,{signal:controller.signal,report:this.report,stage:message=>{this.message=message;this.report(message);}})).then(()=>{controller.signal.throwIfAborted();this.phase='ready';this.message='IndexTTS 2.0'+(this.driver.engineLabel?' · '+this.driver.engineLabel:'')+' 已准备好';this.seedExample();}).catch(error=>{this.phase=this.driver.installed(directory)?'ready':controller.signal.aborted?'uninstalled':'failed';this.message=controller.signal.aborted?'准备已取消，已下载的文件保留，可继续':error.message;this.report(this.message);}).finally(()=>{if(this.preparation===active)this.preparation=undefined;});return this.status();
 }
 async cancelPreparation(){this.preparation?.controller.abort();await this.preparation?.done;return this.status();}
 addVoice(name:string,bytes:Uint8Array,cleanup=false,sourceVoiceId?:string){
  this.check();name=required(name,120);if(bytes.length>6*1024*1024)throw new ServiceError('TOO_LARGE','参考声音不能超过 6 MiB');
  const info=wavInfo(bytes);if(info.duration<.3||info.duration>15.1||info.peak<.001)throw new ServiceError('INVALID_AUDIO','参考声音需要 0.3–15 秒，并包含可听见的人声');
  if(cleanup&&!this.driver.cleanReference)throw new ServiceError('CLEANUP_UNAVAILABLE','当前运行环境不支持参考人声清理');
  const voice:SpeechVoice={id:`voice-${randomUUID()}`,name,duration:info.duration,sha256:hash(bytes),createdAt:new Date().toISOString(),sourceVoiceId,processing:cleanup?{state:'queued',stage:'等待清理人声',sourceSha256:hash(bytes)}:undefined},path=this.voicePath(voice.id);
  writeFileSync(path,bytes,{flag:'wx',mode:0o600});
  try{if(cleanup)writeFileSync(this.voicePath(voice.id,true),bytes,{flag:'wx',mode:0o600});const result=this.change(()=>{this.data.voices.push(voice);return voice;});if(cleanup)this.pump();return result;}
  catch(e){for(const file of [path,this.voicePath(voice.id,true)])if(existsSync(file))unlinkSync(file);throw e;}
 }
 private voicePath(id:string,original=false){return this.store.path('speech','voices',`${identity(id)}${original?'.original':''}.wav`);}
 private voice(id:string){return this.data.voices.find(v=>v.id===identity(id))??(()=>{throw new ServiceError('NOT_FOUND','参考声音不存在');})();}
 voiceAudio(id:string,original=false){const voice=this.voice(id);if(!original&&voice.processing&&voice.processing.state!=='succeeded')throw new ServiceError('VOICE_NOT_READY','参考声音仍在处理或处理未完成，请等待或重试');const source=original&&!!voice.processing,bytes=new Uint8Array(readFileSync(this.voicePath(id,source)));if(hash(bytes)!==(source?voice.processing!.sourceSha256:voice.sha256))throw new ServiceError('SOURCE_CHANGED','参考音频发生外部修改，请重新上传');return bytes;}
 updateVoice(id:string,patch:{name?:string;favorite?:boolean}){this.check();this.voice(id);return this.change(()=>{const v=this.voice(id);if(patch.name!==undefined)v.name=required(patch.name,120);if(patch.favorite!==undefined)v.favorite=patch.favorite;return v;});}
 cleanVoice(id:string){this.check();const voice=this.voice(id);if(!this.driver.cleanReference)throw new ServiceError('CLEANUP_UNAVAILABLE','当前运行环境不支持参考人声清理');if(!voice.processing)return this.addVoice(voice.name+' · 清理版',this.voiceAudio(id),true,id);if(['failed','interrupted'].includes(voice.processing.state)){this.voiceAudio(id,true);this.change(()=>{voice.processing!.state='queued';voice.processing!.stage='等待重新清理';voice.processing!.error=undefined;});this.pump();}return copy(voice);}
 private cleanReference(voice:SpeechVoice){
  const id=voice.id,controller=new AbortController(),active={id,kind:'voice' as const,controller,done:Promise.resolve()};this.active=active;
  const temporary=this.store.path('speech','voices',`${id}.partial.wav`);
  active.done=Promise.resolve().then(async()=>{
   this.change(()=>{const p=this.voice(id).processing!;p.state='running';p.stage='准备人声清理模型';});this.voiceAudio(id,true);
   await this.driver.cleanReference!(this.directory(),{referencePath:this.voicePath(id,true),outputPath:temporary},{signal:controller.signal,report:this.report,stage:stage=>{if(!controller.signal.aborted)this.change(()=>{this.voice(id).processing!.stage=stage;});}});
   controller.signal.throwIfAborted();const bytes=new Uint8Array(readFileSync(temporary)),info=wavInfo(bytes);if(info.duration<.3||info.duration>15.1||info.peak<.001)throw new ServiceError('INVALID_AUDIO','清理后没有可用的人声，请换一个片段或使用原音');
   renameSync(temporary,this.voicePath(id));try{this.change(()=>{const v=this.voice(id);v.sha256=hash(bytes);v.duration=info.duration;Object.assign(v.processing!,{state:'succeeded',stage:'人声清理完成',error:undefined,pipeline:'UVR-MDX-NET-Voc_FT + UVR-DeNoise-Lite + UVR-DeEcho-DeReverb'});});}catch(e){copyFileSync(this.voicePath(id,true),this.voicePath(id));throw e;}
  }).catch(error=>{const v=this.voice(id);if(['queued','running'].includes(v.processing!.state)){const fail=()=>{const current=this.voice(id);current.processing!.state='failed';current.processing!.stage='人声清理失败';current.processing!.error=error.message??String(error);};try{this.change(fail);}catch{fail();}this.report(this.voice(id).processing!.error??String(error));}}).finally(()=>{if(existsSync(temporary))unlinkSync(temporary);if(this.active===active)this.active=undefined;this.pump();});
 }

 async createSound(projectId:string,title:string){this.check();await this.store.project(projectId);const sound:SpeechSound={id:`speech-${randomUUID()}`,projectId,title:required(title,120),createdAt:new Date().toISOString()};return this.change(()=>{this.data.sounds.push(sound);return sound;});}
 job(id:string){const v=this.data.versions.find(v=>v.id===identity(id));if(!v)throw new ServiceError('NOT_FOUND','语音版本不存在');return copy(v);}
 generate(input:SpeechGenerate){this.check();if(!this.status().canGenerate)throw new ServiceError('SPEECH_UNAVAILABLE','请先准备 IndexTTS 2.0 环境和模型');const sound=this.data.sounds.find(s=>s.id===input.soundId),voice=this.data.voices.find(v=>v.id===input.voiceId);if(!sound||!voice)throw new ServiceError('NOT_FOUND','声音项目或参考声音不存在');this.voiceAudio(voice.id);if(input.parentId&&!this.data.versions.some(v=>v.id===input.parentId&&v.soundId===sound.id&&v.state==='succeeded'&&!v.deleted))throw new ServiceError('INVALID_PARENT','来源版本必须属于当前声音，且已完成');
  const v:SpeechVersion={id:`speech-v-${randomUUID()}`,projectId:sound.projectId,soundId:sound.id,number:Math.max(0,...this.data.versions.filter(v=>v.soundId===sound.id).map(v=>v.number))+1,parentId:input.parentId,voiceId:voice.id,voiceName:voice.name,text:required(input.text,8000),emotion:input.emotion?.trim().slice(0,2000)||undefined,engine:'IndexTTS 2.0',backend:this.driver.engineLabel,state:'queued',stage:'等待生成',createdAt:new Date().toISOString(),kept:false,deleted:false};this.change(()=>{this.data.versions.push(v);});this.pump();return this.job(v.id);
 }
 private pump(){if(this.closing||this.active)return;const voice=this.data.voices.find(v=>v.processing?.state==='queued');if(voice){this.cleanReference(voice);return;}const next=this.data.versions.find(v=>v.state==='queued');if(!next)return;const id=next.id,controller=new AbortController(),active={id,kind:'speech' as const,controller,done:Promise.resolve()};this.active=active;
  active.done=Promise.resolve().then(async()=>{if(this.job(id).state!=='queued')return;this.change(()=>{const v=this.data.versions.find(v=>v.id===id)!;v.state='running';v.stage='准备语音生成';});const request=this.job(id),temporary=this.store.path('speech','audio',`${id}.partial.wav`);try{
   await this.driver.generate(this.directory(),{text:request.text,emotion:request.emotion,referencePath:this.voicePath(request.voiceId),outputPath:temporary},{signal:controller.signal,report:this.report,stage:message=>{if(!controller.signal.aborted)this.change(()=>{this.data.versions.find(v=>v.id===id)!.stage=message;});}});controller.signal.throwIfAborted();const bytes=new Uint8Array(readFileSync(temporary)),info=wavInfo(bytes);if(info.peak<.0001)throw new ServiceError('EMPTY_AUDIO','模型输出没有可听见的声音，请重试');const artifact={...info,bytes:bytes.length,sha256:hash(bytes)};renameSync(temporary,this.store.path('speech','audio',`${id}.wav`));this.change(()=>{const v=this.data.versions.find(v=>v.id===id)!;v.state='succeeded';v.stage='生成完成';v.artifact=artifact;});
  }finally{if(existsSync(temporary))unlinkSync(temporary);}}).catch(error=>{const message=error?.message??String(error),v=this.data.versions.find(v=>v.id===id)!;if(['queued','running'].includes(v.state)){try{this.change(()=>{const v=this.data.versions.find(v=>v.id===id)!;v.state='failed';v.stage='生成失败';v.error=message;v.artifact=undefined;});}catch(persistError){const current=this.data.versions.find(v=>v.id===id)!;current.state='failed';current.stage='版本记录保存失败';current.error=`${message}；保存失败：${persistError instanceof Error?persistError.message:String(persistError)}`;current.artifact=undefined;this.report(current.error);}}this.report(message);}).finally(()=>{if(this.active===active)this.active=undefined;this.pump();});
 }
 async cancel(id:string){this.check();const v=this.job(id);if(!['queued','running'].includes(v.state))return v;const active=this.active;try{this.change(()=>{const v=this.data.versions.find(v=>v.id===id)!;v.state='cancelled';v.stage='已取消';});}finally{if(active?.id===id){active.controller.abort();await active.done;}}return this.job(id);}
 updateVersion(id:string,patch:{kept?:boolean;final?:boolean;deleted?:boolean}){this.check();const old=this.job(id);if(['running','queued'].includes(old.state))throw new ServiceError('SPEECH_BUSY','请先取消生成，再修改版本');if(patch.final&&(!['succeeded'].includes(old.state)||old.deleted||patch.deleted))throw new ServiceError('INVALID_VERSION','只能将已完成的版本选作成品');return this.change(()=>{const v=this.data.versions.find(v=>v.id===id)!,s=this.data.sounds.find(s=>s.id===v.soundId)!;if(patch.kept!==undefined)v.kept=patch.kept;if(patch.deleted!==undefined)v.deleted=patch.deleted;if(patch.final)s.finalVersionId=id;if(patch.final===false&&s.finalVersionId===id||v.deleted&&s.finalVersionId===id)s.finalVersionId=undefined;return v;});}
 audio(id:string,includeDeleted=false){const v=this.job(id);if(v.state!=='succeeded'||!v.artifact||v.deleted&&!includeDeleted)throw new ServiceError('NOT_FOUND','当前版本没有可下载的音频');const bytes=new Uint8Array(readFileSync(this.store.path('speech','audio',`${identity(id)}.wav`)));if(bytes.length!==v.artifact.bytes||hash(bytes)!==v.artifact.sha256)throw new ServiceError('SOURCE_CHANGED','已保存音频发生外部修改');return bytes;}
 async close(){if(this.closing)return;this.closing=true;this.preparation?.controller.abort();await this.preparation?.done;const active=this.active;active?.controller.abort();try{this.change(()=>{for(const v of this.data.versions)if(['running','queued'].includes(v.state)){v.state='interrupted';v.stage='服务已停止，可重新生成';}for(const v of this.data.voices)if(v.processing&&['running','queued'].includes(v.processing.state)){v.processing.state='interrupted';v.processing.stage='清理已中断，可以重试';}});}finally{await active?.done;await this.driver.close?.();}}
}
