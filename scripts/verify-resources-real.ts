import {mkdir,readFile,writeFile,copyFile,symlink,stat,readdir} from 'node:fs/promises';
import {constants,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ResourceCoordinator} from '../src/service/resources/coordinator.ts';
import {ResourceLease} from '../src/service/resources/lease.ts';
import {probeHardware,observeProcesses} from '../src/service/resources/telemetry.ts';
import {estimateResources} from '../src/service/resources/profiles.ts';
import {MusicService} from '../src/service/service.ts';
import {processRenderer} from '../src/service/render/process.ts';
import {createYuE2Driver} from '../src/service/yue2/runtime.ts';
import {createSpeechDriver} from '../src/service/tts/runtime.ts';
import {createNativeConversionDriver} from '../src/service/conversion/native.ts';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
assert.equal(process.platform,'darwin','当前实测脚本仅适配 macOS');assert.equal(process.arch,'arm64','真实模型仅适配 Apple Silicon');
const sourceTTS=process.env.MUSIC_ROOM_TTS_SOURCE??join(homedir(),'Music','IndexTTS2'),sourceYue=process.env.MUSIC_ROOM_YUE_SOURCE??join(homedir(),'Music','YuE2'),sourceConversion=process.env.MUSIC_ROOM_CONVERSION_SOURCE??join(homedir(),'Music','MusicRoom','engines','voice-conversion');

// Controlled calibration only: thresholds are explicit guards, never evidence of measured peaks.
const out=resolve('test-results/resources-real'),root=process.env.MUSIC_ROOM_RESOURCE_RUN??join(out,`run-${Date.now()}`);await mkdir(root,{recursive:true});
const read=(path:string)=>readFile(resolve('public',path));
const cp=async(source:string,target:string)=>{await mkdir(join(target,'..'),{recursive:true});await copyFile(source,target,constants.COPYFILE_FICLONE);};
async function tree(source:string,target:string){await mkdir(target,{recursive:true});for(const e of await readdir(source,{withFileTypes:true})){if(e.name==='.cache'||e.name==='__pycache__')continue;const a=join(source,e.name),b=join(target,e.name);if(e.isDirectory())await tree(a,b);else if(e.isFile())await cp(a,b);}}
async function environment(source:string,target:string){await mkdir(join(target,'bin'),{recursive:true});await cp(join(source,'pyvenv.cfg'),join(target,'pyvenv.cfg'));await symlink(join(source,'bin/python'),join(target,'bin/python'));await symlink(join(source,'lib'),join(target,'lib'));}
const tts=join(root,'tts'),yue=join(root,'yue');if(!process.env.MUSIC_ROOM_RESOURCE_RUN){await mkdir(tts);await cp(join(sourceTTS,'.music-room-indextts.json'),join(tts,'.music-room-indextts.json'));await tree(join(sourceTTS,'audio-cpp'),join(tts,'audio-cpp'));
await tree(join(sourceTTS,'reference-cleanup/models'),join(tts,'reference-cleanup/models'));await cp(join(sourceTTS,'reference-cleanup/installed.json'),join(tts,'reference-cleanup/installed.json'));await environment(join(sourceTTS,'reference-cleanup/.venv'),join(tts,'reference-cleanup/.venv'));await cp(join(sourceTTS,'bin/uv'),join(tts,'bin/uv'));
await mkdir(yue);await tree(join(sourceYue,'source'),join(yue,'source'));await tree(join(sourceYue,'models'),join(yue,'models'));await environment(join(sourceYue,'.venv'),join(yue,'.venv'));await cp(join(sourceYue,'.music-room-yue2.json'),join(yue,'.music-room-yue2.json'));const installed=JSON.parse(await readFile(join(sourceYue,'installed.json'),'utf8'));await writeFile(join(yue,'installed.json'),JSON.stringify({...installed,directory:yue}));
// Clone timestamps are preserved in metadata; readiness depends on actual staged file identity.
const native=JSON.parse(await readFile(join(tts,'audio-cpp/installed.json'),'utf8'));for(const [key,path] of [['program','release/audiocpp_server'],['model','models/index-tts2-f16.gguf']]){const s=await stat(join(tts,'audio-cpp',path));native[key]={bytes:s.size,mtimeMs:s.mtimeMs};}await writeFile(join(tts,'audio-cpp/installed.json'),JSON.stringify(native));
}
const thresholds={tts:6*2**30,reference:8*2**30,conversion:10*2**30,yue2:14*2**30};
const resources=new ResourceCoordinator({lease:new ResourceLease(),policy:{reserveFraction:.3,reserveMinimum:2*2**30,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:25*60*1000,retryMs:1000,maxQueue:64},probe:probeHardware,observe:observeProcesses,estimate:(engine,input)=>engine in thresholds?{verified:true,peak:{memory:thresholds[engine as keyof typeof thresholds]}}:estimateResources(engine,input)});
const service=await MusicService.open(join(root,'workspace'),processRenderer(),read,false,createYuE2Driver(read),createSpeechDriver(undefined,undefined,read),createNativeConversionDriver(sourceConversion),resources);
const report:{started:string;root:string;hardware:unknown;thresholds:unknown;results:unknown[];resources?:unknown;error?:string;finished?:string}={started:new Date().toISOString(),root,hardware:await probeHardware(),thresholds,results:[]};
const save=()=>writeFile(join(root,'verification.json'),JSON.stringify(report,null,2));
const wait=async(get:()=>any,terminal:string[],field='state')=>{const until=Date.now()+25*60*1000;let last='';for(;;){const value=await get(),display=JSON.stringify({id:value.id,state:value[field],stage:value.stage,progress:value.progress,error:value.error});if(display!==last){console.log(display);last=display;report.resources=resources.snapshot();await save();}if(terminal.includes(value[field]))return value;if(Date.now()>until)throw Error('真实任务超时');await new Promise(r=>setTimeout(r,2000));}};
try{
 await service.speech.prepare(tts);await wait(()=>service.speech.status(),['ready','failed'],'phase');assert.ok(service.speech.status().canGenerate);
 if(!(await service.store.projects()).some(p=>p.id==='resources-real'))await service.call('create_project',{projectId:'resources-real',title:'资源管理隔离验收'});const sound=await service.speech.createSound('resources-real','语音');const voice=service.speech.snapshot().voices.find(v=>v.builtinId==='official')??service.speech.snapshot().voices[0];assert.ok(voice);
 const speech=await service.speech.generate({soundId:sound.id,voiceId:voice.id,text:'你好，欢迎回来。今天的故事从这里开始。',seed:42});const spoken=await wait(()=>service.speech.job(speech.id),['succeeded','failed','cancelled']);assert.equal(spoken.state,'succeeded',spoken.error);report.results.push({kind:'tts',job:spoken});await save();
 const raw=new Uint8Array(await read('tts-presets/official.wav')),clean=service.speech.addVoice('受控参考',raw,true);const cleaned=await wait(()=>service.speech.snapshot().voices.find(v=>v.id===clean.id)!.processing,['succeeded','failed','cancelled']);assert.equal(cleaned.state,'succeeded',cleaned.error);report.results.push({kind:'reference',job:cleaned});await save();
 const long=service.speech.addVoice('15 秒边界',new Uint8Array(await read('tts-presets/tianjin.wav')),true);const longer=await wait(()=>service.speech.snapshot().voices.find(v=>v.id===long.id)!.processing,['succeeded','failed','cancelled']);assert.equal(longer.state,'succeeded',longer.error);report.results.push({kind:'reference-long',job:longer});await save();
 const conversion=service.conversion.add('speech.wav',raw,{id:voice.id,name:voice.name,audio:service.speech.voiceAudio(voice.id)},`calibration-${Date.now()}`);const converted=await wait(()=>service.conversion.get(conversion.id),['succeeded','failed','cancelled']);assert.equal(converted.state,'succeeded',converted.error);report.results.push({kind:'conversion',job:converted});await save();
 await service.yue2.prepare(yue,false);await wait(()=>service.yue2.status(),['stopped','failed'],'phase');assert.ok((await service.yue2.status()).canGenerate);
 const music=await service.yue2Client.generate({style:'Instrumental piano, a short melodic miniature with a natural ending. No singing.',lyrics:'[instrumental]',preset:'fast',instrumental:true,seed:42,title:'资源管理隔离验收'});const generated=await wait(async()=>(await service.yue2Client.job(music.job.id)).job,['done','failed','cancelled'],'status');assert.equal(generated.status,'done',generated.error);report.results.push({kind:'yue2',job:generated});await save();
 const vocal=await service.yue2Client.generate({style:'Mandarin piano ballad, warm solo vocal, short song.',lyrics:'[Verse]\n晚风轻轻吹过窗边\n把今天的故事说完\n[Chorus]\n留一盏灯等你回来',preset:'quality',instrumental:false,seed:42,title:'质量档资源验收'});const sung=await wait(async()=>(await service.yue2Client.job(vocal.job.id)).job,['done','failed','cancelled'],'status');assert.equal(sung.status,'done',sung.error);report.results.push({kind:'yue2-quality-vocal',job:sung});await save();
 await service.yue2.stop();assert.ok((await service.yue2Client.audio(music.job.id)).length>44);assert.deepEqual(resources.snapshot().residents,[]);
}catch(error){report.error=String(error);throw error;}finally{await service.close();report.resources=resources.snapshot();report.finished=new Date().toISOString();await save();console.log(JSON.stringify({report:join(root,'verification.json'),results:report.results.length,error:report.error}));}
