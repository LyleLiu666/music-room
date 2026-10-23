// One production resource queue, real heterogeneous engines, isolated task files.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {MusicService} from '../src/service/service.ts';
import {createResources} from '../src/service/resources/runtime.ts';
import {createSpeechDriver} from '../src/service/tts/runtime.ts';
import {createYuE2Driver} from '../src/service/yue2/runtime.ts';
import {createNativeConversionDriver} from '../src/service/conversion/native.ts';
import {processRenderer} from '../src/service/render/process.ts';
import {processIdentity} from '../src/service/resources/lease.ts';
import {groupMembers} from '../src/service/resources/processes.ts';
assert.equal(process.env.MUSIC_ROOM_MIXED_REAL,'1','explicit real-model opt-in required');
assert.ok(process.env.MUSIC_ROOM_RESOURCE_RUN,'pinned isolated installation required');
const installation=resolve(process.env.MUSIC_ROOM_RESOURCE_RUN!),out=resolve('test-results/mixed-real',`run-${Date.now()}`),workspace=join(out,'workspace');
// Queue acceptance uses the pinned music corpus; open-ended planning failures remain separate quality evidence.
const corpusBytes=await readFile('tests/quality/cases.json'),corpus=JSON.parse(corpusBytes.toString());
const musicCase=corpus.cases.find((entry:any)=>entry.id==='Q-MUSIC-01');assert.equal(musicCase?.kind,'music');
const musicInput={...musicCase.input,seed:corpus.seeds[0],title:'真实混合音乐'};
await mkdir(join(workspace,'speech'),{recursive:true});await mkdir(join(workspace,'engines'),{recursive:true});
await writeFile(join(workspace,'speech/library.json'),JSON.stringify({format:'music-room-speech',version:1,directory:join(installation,'tts'),voices:[],sounds:[],versions:[]}));
await writeFile(join(workspace,'engines/yue2.json'),JSON.stringify({version:1,directory:join(installation,'yue'),autoStart:true}));
const read=(p:string)=>readFile(resolve('public',p)),resources=createResources(read);
const service=await MusicService.open(workspace,processRenderer(),read,false,createYuE2Driver(read),createSpeechDriver(undefined,undefined,read),createNativeConversionDriver(join(homedir(),'Music/MusicRoom/engines/voice-conversion')),resources);
const report:any={startedAt:new Date().toISOString(),status:'running',realModels:true,resourcePolicy:'unchanged production profiles and guards',installation,workspace,musicInput:{caseId:musicCase.id,corpusSha256:createHash('sha256').update(corpusBytes).digest('hex'),request:musicInput},checks:[],transitions:[]};
const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));let pendingSpeech:string|undefined,pendingMusic:string|undefined,pendingConversion:string|undefined;
const ownedWorkers=new Map<string,{pid:number;started:string;group?:boolean}>(),leasePath=join(homedir(),'Library/Application Support/MusicRoom/resources/heavy-task.json');
try{
 report.hardware=(await resources.status()).hardware;
 await service.store.createProject('mixed','真实模型混合队列');const sound=await service.speech.createSound('mixed','真实混合语音');const voice=service.speech.snapshot().voices.find(v=>v.builtinId==='official')!;assert.ok(voice);
 resources.pause();
 const tts=service.speech.generate({soundId:sound.id,voiceId:voice.id,text:'真实模型混合队列测试，语音与音乐轮流运行。',seed:42});pendingSpeech=tts.id;
 const conversion=service.conversion.add('mixed.wav',new Uint8Array(await read('tts-presets/official.wav')),{id:voice.id,name:voice.name,audio:service.speech.voiceAudio(voice.id)},'mixed-conversion');pendingConversion=conversion.id;
 const music=await service.yue2Client.generate(musicInput);pendingMusic=music.job.id;
 const cancelled=service.speech.generate({soundId:sound.id,voiceId:voice.id,text:'排队取消任务，不应加载模型。',seed:43});
 assert.equal(service.speech.job(tts.id).state,'queued');assert.equal(service.conversion.get(conversion.id).state,'queued');
 assert.equal((await service.yue2Client.job(music.job.id)).job.status,'queued');
 await service.speech.cancel(cancelled.id);assert.equal(service.speech.job(cancelled.id).state,'cancelled');assert.equal(existsSync(join(workspace,'speech/audio',cancelled.id+'.wav')),false);
 assert.ok(!resources.snapshot().queued.some(task=>task.id===cancelled.id));report.checks.push('TTS, conversion and music enter one paused production queue; queued cancellation publishes no audio and consumes no slot');report.cancelled=service.speech.job(cancelled.id);await save();resources.resume();
 const deadline=Date.now()+45*60000;let last='';
 for(;;){
  const jobs={tts:service.speech.job(tts.id),conversion:service.conversion.get(conversion.id),music:(await service.yue2Client.job(music.job.id)).job};
  const snapshot=resources.snapshot(),state=JSON.stringify({tts:jobs.tts.state,conversion:jobs.conversion.state,music:jobs.music.status,active:snapshot.active?.engine,queued:snapshot.queued.map(t=>t.engine)});
  try{const lease=JSON.parse(await readFile(leasePath,'utf8'));if(lease.parent.pid===process.pid)for(const worker of lease.workers)ownedWorkers.set(worker.pid+':'+worker.started,worker);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  if(state!==last){last=state;report.transitions.push({at:new Date().toISOString(),state:JSON.parse(state),resources:snapshot});await save();console.log(state);}
  for(const job of [jobs.tts,jobs.conversion])assert.ok(!['failed','interrupted','cancelled'].includes(job.state),JSON.stringify(job));
  assert.ok(!['failed','cancelled'].includes(jobs.music.status),JSON.stringify(jobs.music));
  if(jobs.tts.state==='succeeded'&&jobs.conversion.state==='succeeded'&&jobs.music.status==='done'){report.jobs=jobs;break;}
  assert.ok(Date.now()<deadline,'real mixed queue timeout');await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(service.speech.audio(tts.id).length>44);assert.ok(service.conversion.audio(conversion.id,'converted').length>44);assert.ok((await service.yue2Client.audio(music.job.id)).length>44);
 await service.yue2.stop();for(let n=0;n<300&&(resources.snapshot().active||resources.snapshot().residents.length);n++)await new Promise(r=>setTimeout(r,100));
 assert.equal(resources.snapshot().active,undefined);assert.deepEqual(resources.snapshot().residents,[]);assert.equal(resources.snapshot().queued.length,0);
 report.ownedWorkers=[...ownedWorkers.values()];assert.ok(report.ownedWorkers.length,'actual model workers must have been observed');
 for(const worker of ownedWorkers.values()){assert.notEqual(processIdentity(worker.pid)?.started,worker.started,'owned model worker survived resource release');if(worker.group)assert.deepEqual(groupMembers(worker.pid),[],'owned model process group survived resource release');}
 report.checks.push('three real engine jobs finish through the production coordinator; all saved audio remains readable after resident release');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 if(pendingSpeech&&['queued','running'].includes(service.speech.job(pendingSpeech).state))await service.speech.cancel(pendingSpeech);
 if(pendingConversion&&['queued','running'].includes(service.conversion.get(pendingConversion).state))await service.conversion.cancel(pendingConversion);
 if(pendingMusic){try{const job=(await service.yue2Client.job(pendingMusic)).job;if(['queued','running'].includes(job.status))await service.yue2Client.cancel(pendingMusic);}catch{}}
 await service.close();report.finishedAt=new Date().toISOString();report.resources=resources.snapshot();await save();console.log(JSON.stringify({report:join(out,'verification.json'),status:report.status,error:report.error}));
}
