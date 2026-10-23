// Real, resumable corpus execution. Objective checks do not assign listening scores.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {appendFileSync,existsSync,statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {MusicService} from '../src/service/service.ts';
import {createSpeechDriver} from '../src/service/tts/runtime.ts';
import {createYuE2Driver} from '../src/service/yue2/runtime.ts';
import {createNativeConversionDriver} from '../src/service/conversion/native.ts';
import {createResources} from '../src/service/resources/runtime.ts';
import {processRenderer} from '../src/service/render/process.ts';
import {homedir} from 'node:os';
import {generationSummary,qualityExecutionPassed} from '../tests/quality/execution.ts';
import {waitForRealJob} from '../tests/quality/poll.ts';
import {createAwakeClock} from '../tests/quality/awake-clock.ts';
import {validateCompletedTrial,validateResumeContext} from '../tests/quality/resume.ts';
if(process.env.MUSIC_ROOM_QUALITY_REAL!=='1')throw Error('Set MUSIC_ROOM_QUALITY_REAL=1');
const installation=resolve(process.env.MUSIC_ROOM_RESOURCE_RUN??''),tts=join(installation,'tts'),yue=join(installation,'yue');
assert.ok(existsSync(join(tts,'audio-cpp/installed.json'))&&existsSync(join(yue,'installed.json')),'isolated installed models required');
const out=resolve(process.env.MUSIC_ROOM_QUALITY_RUN??'test-results/quality/real'),workspace=join(out,'workspace');
await mkdir(join(workspace,'speech'),{recursive:true});await mkdir(join(workspace,'engines'),{recursive:true});
if(!existsSync(join(workspace,'speech/library.json')))await writeFile(join(workspace,'speech/library.json'),JSON.stringify({format:'music-room-speech',version:1,directory:tts,voices:[],sounds:[],versions:[]}));
await writeFile(join(workspace,'engines/yue2.json'),JSON.stringify({version:1,directory:yue,autoStart:true}));
// Reuse pinned local ASR/aligner files while keeping task files and review caches isolated.
const lyricSource=join(homedir(),'Music/MusicRoom/engines/lyrics'),lyricTarget=join(workspace,'engines/lyrics');
const read=(p:string)=>readFile(resolve('public',p));let currentLog='';
const record=(message:string)=>{if(currentLog)appendFileSync(currentLog,new Date().toISOString()+' '+message+'\n');};
const speech=createSpeechDriver(undefined,undefined,read),generate=speech.generate;
speech.generate=(directory,request,context)=>generate(directory,request,{...context,report:message=>{record(message);context.report(message);}});
const music=createYuE2Driver(read),launch=music.launch;music.launch=(directory,context)=>launch(directory,{...context,report:message=>{record(message);context.report(message);}});
const file=join(out,'execution.json'),report:any=existsSync(file)?JSON.parse(await readFile(file,'utf8')):{startedAt:new Date().toISOString(),realInference:true,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),installation,workspace,trials:[]};
const models:any={tts:JSON.parse(await readFile(join(tts,'audio-cpp/installed.json'),'utf8')),music:JSON.parse(await readFile(join(yue,'installed.json'),'utf8')),conversion:JSON.parse(await readFile(join(homedir(),'Music/MusicRoom/engines/voice-conversion/installed.json'),'utf8'))};
const lyricIdentity=resolve('test-results/quality/lyrics-model-identity.json');
if(existsSync(lyricIdentity))models.lyrics=JSON.parse(await readFile(lyricIdentity,'utf8'));
const corpus=JSON.parse(await readFile('test-results/quality/corpus.json','utf8'));
assert.ok(corpus.sources&&Object.keys(corpus.sources).length>0,'Run npm run prepare:quality first');
for(const [source,expected]of Object.entries(corpus.sources)){
 const path=source.startsWith('prepared/')?resolve('test-results/quality',source):resolve(source);
 assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),expected,`corpus source changed: ${source}`);
}
if(report.trials.length)validateResumeContext(report,{models,corpusSources:corpus.sources});
const catalogue=JSON.parse(await readFile('tests/quality/cases.json','utf8'));
const variants=(c:any)=>['tts','music'].includes(c.kind)?catalogue.seeds.map((seed:number,index:number)=>({run:index+1,seed})):c.kind==='speed'?c.input.rates.map((rate:number)=>({rate})):[{}];
// Validate all reusable evidence before starting a worker or overwriting report metadata.
for(const c of catalogue.cases.filter((c:any)=>c.kind!=='lyrics'))for(const run of variants(c)){
 const key=c.id+'-'+(run.run??run.rate??1);
 await validateCompletedTrial(report.trials.findLast((trial:any)=>trial.key===key),{key,caseId:c.id,input:c.input,...run},readFile);
}
report.models=models;report.corpusSources=corpus.sources;
if(existsSync(join(lyricSource,'installed.json'))&&!existsSync(lyricTarget)){
 await mkdir(lyricTarget);for(const part of ['installed.json','venv','asr-model','aligner-model'])execFileSync('/bin/cp',['-cR',join(lyricSource,part),join(lyricTarget,part)]);
}
const service=await MusicService.open(workspace,processRenderer(),read,false,music,speech,createNativeConversionDriver(join(homedir(),'Music/MusicRoom/engines/voice-conversion')),createResources(read));
const generatorSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
report.generators??=report.generatorSha256?[{sha256:report.generatorSha256,startedAt:report.startedAt}]:[];
if(report.generators.at(-1)?.sha256!==generatorSha256)report.generators.push({sha256:generatorSha256,startedAt:new Date().toISOString()});
report.generatorSha256=generatorSha256;
report.waitHelperSha256=Object.fromEntries(await Promise.all(['poll.ts','awake-clock.ts','awake-clock.c','resume.ts'].map(async name=>[name,createHash('sha256').update(await readFile(new URL('../tests/quality/'+name,import.meta.url))).digest('hex')])));
const save=()=>writeFile(file,JSON.stringify(report,null,2));
for(const trial of report.trials)if(trial.status==='running'){trial.status='interrupted';trial.error='Previous executor ended before recording a terminal result';}
let stopping=false;
const stop=()=>{stopping=true;void service.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
const selected=process.env.MUSIC_ROOM_QUALITY_CASES?.split(',');
const requiredKeys:string[]=catalogue.cases.filter((c:any)=>c.kind!=='lyrics'&&(!selected||selected.includes(c.id))).flatMap((c:any)=>variants(c).map((run:any)=>c.id+'-'+(run.run??run.rate??1)));
const allRequiredKeys:string[]=catalogue.cases.filter((c:any)=>c.kind!=='lyrics').flatMap((c:any)=>variants(c).map((run:any)=>c.id+'-'+(run.run??run.rate??1)));
report.requestedCases=selected??catalogue.cases.map((c:any)=>c.id);report.listeningStatus='pending';
let awakeClock:Awaited<ReturnType<typeof createAwakeClock>>|undefined;
const wait=async(get:()=>any,terminal:string[],cancel:()=>Promise<unknown>,field='state')=>{let last='';return waitForRealJob<any>({get,terminal:value=>terminal.includes(value[field]),now:()=>awakeClock!.now(),timeoutMs:40*60000,intervalMs:2000,cancel,progress:value=>{const display=JSON.stringify(value);if(display!==last){record(display);last=display;console.log(JSON.stringify({state:value[field],stage:value.stage??value.progress?.label,completed:value.progress?.completed,total:value.progress?.total,error:value.error}));}}});};
const analyse=(path:string)=>JSON.parse(execFileSync(join(yue,'.venv/bin/python'),['-c',`import soundfile as sf,numpy as np,json,sys
x,sr=sf.read(sys.argv[1],always_2d=True);assert x.size and np.isfinite(x).all();a=np.abs(x)
print(json.dumps(dict(sampleRate=sr,channels=x.shape[1],frames=len(x),duration=len(x)/sr,peak=float(a.max()),rms=float(np.sqrt(np.mean(x*x))),clippedFraction=float(np.mean(a>=.999)),lastSecondRms=float(np.sqrt(np.mean(x[-sr:]*x[-sr:]))))))`,path],{encoding:'utf8'}));
try{
 awakeClock=await createAwakeClock();report.waitClock='macOS mach_absolute_time; awake elapsed time, terminal result checked before timeout';
 report.hardware=(await service.resources.status()).hardware;
 if(!(await service.store.projects()).some(p=>p.id==='quality'))await service.store.createProject('quality','固定语料真实验收');
 const official=service.speech.snapshot().voices.find(v=>v.builtinId==='official')!;assert.ok(official);
 const target=service.speech.snapshot().voices.find(v=>v.builtinId==='tianjin')??service.speech.addVoice('固定天津参考',new Uint8Array(await read('tts-presets/tianjin.wav')));
 for(const c of catalogue.cases){if(stopping)break;if(selected&&!selected.includes(c.id))continue;
  if(c.kind==='lyrics')continue;
  for(const run of variants(c)){const key=c.id+'-'+(run.run??run.rate??1);if(stopping)continue;if(report.trials.findLast((r:any)=>r.key===key)?.status==='succeeded')continue;
   const trial:any={key,caseId:c.id,...run,input:c.input,startedAt:new Date().toISOString(),status:'running'};report.trials.push(trial);currentLog=join(out,key+'-'+Date.now()+'.log');trial.log=currentLog;record('REQUEST '+JSON.stringify(trial));await save();
   try{
    const disk=statfsSync(workspace);if(c.kind!=='speed'&&Number(disk.bavail)*Number(disk.bsize)<10*2**30)throw Object.assign(Error('Fewer than 10 GiB available for this real-model acceptance run; inference was not started'),{code:'SYSTEM_DISK_LOW'});
    if(c.kind==='speed')service.resources.checkDisk(workspace,64*2**20);
    let bytes:Uint8Array,extension='wav';
    if(c.kind==='tts'){
     const sound=await service.speech.createSound('quality',key),text=c.input.text.repeat(c.input.repeat??1);
     const job=service.speech.generate({soundId:sound.id,voiceId:official.id,text,emotionStrength:c.input.emotionStrength,seed:run.seed});trial.versionId=job.id;await save();
     trial.result=await wait(()=>service.speech.job(job.id),['succeeded','failed','cancelled','interrupted'],()=>service.speech.cancel(job.id));assert.equal(trial.result.state,'succeeded',trial.result.error);bytes=service.speech.audio(job.id);
    }else if(c.kind==='music'){
     const sound=await service.studio.createSound({projectId:'quality',title:key,kind:'music'});
     const job=await service.studio.generate({soundId:sound.id,text:c.input.style,...c.input,seed:run.seed});trial.versionId=job.id;trial.engineJobId=job.source.id;await save();
     trial.result=await wait(async()=>(await service.yue2Client.job(job.source.id)).job,['done','failed','cancelled'],()=>service.yue2Client.cancel(job.source.id),'status');assert.equal(trial.result.status,'done',trial.result.error);bytes=await service.yue2Client.audio(job.source.id);extension='flac';
    }else if(c.kind==='conversion'){
     const source=c.input.source.startsWith('prepared/')?resolve('test-results/quality',c.input.source):resolve(c.input.source);
     const job=service.conversion.add(key+'.wav',new Uint8Array(await readFile(source)),{id:target.id,name:target.name,audio:service.speech.voiceAudio(target.id)},randomUUID(),undefined,c.input.pitchShiftSemitones);trial.versionId=job.id;await save();
     trial.result=await wait(()=>service.conversion.get(job.id),['succeeded','failed','cancelled','interrupted'],()=>service.conversion.cancel(job.id));assert.equal(trial.result.state,'succeeded',trial.result.error);bytes=service.conversion.audio(job.id,'converted');
     trial.nativeLog=join(workspace,'conversion',job.id,'native.log');
    }else{
     const source=new Uint8Array(await readFile(resolve(c.input.source)));
     bytes=await service.resources.run({id:'quality-speed-'+randomUUID(),engine:'speed',demand:service.resources.estimate('speed',{duration:15,rate:run.rate}),execute:async execution=>{execution.running();return service.speedProcessor(source,run.rate,execution);}});
     trial.scope='production speed processor, saved WAV; studio publication covered separately by UI regression';
    }
    const audio=join(out,key+'.'+extension);await writeFile(audio,bytes);trial.audio=audio;trial.sha256=createHash('sha256').update(bytes).digest('hex');trial.analysis=analyse(audio);assert.ok(trial.analysis.rms>.0001,'non-silent finite output required');trial.status='succeeded';trial.listeningStatus='pending';
    if(c.input.targetDuration)trial.durationTarget={requestedSeconds:c.input.targetDuration,actualSeconds:trial.analysis.duration,relativeDeviation:(trial.analysis.duration-c.input.targetDuration)/c.input.targetDuration,scope:'soft arrangement guidance; retain complete valid score; listening review still required'};
   }catch(error:any){trial.status=error?.code==='SYSTEM_DISK_LOW'?'blocked':stopping?'interrupted':'failed';trial.error=String(error);trial.errorCode=error?.code;record('ERROR '+String(error));}
   finally{trial.finishedAt=new Date().toISOString();trial.resources=service.resources.snapshot();trial.logSha256=createHash('sha256').update(await readFile(trial.log)).digest('hex');await save();console.log(JSON.stringify({key,status:trial.status,error:trial.error}));}
  }
 }
 const vocal=report.trials.find((t:any)=>t.caseId==='Q-MUSIC-02'&&t.status==='succeeded');
 if((!selected||selected.includes('Q-LYRICS-01'))&&vocal){
  currentLog=join(out,'Q-LYRICS-01-'+Date.now()+'.log');
  await service.studio.snapshot();report.lyrics={versionId:vocal.versionId,log:currentLog,...service.lyricsGeneration.status(vocal.versionId),humanTranscript:'pending'};
  record('REQUEST '+JSON.stringify({caseId:'Q-LYRICS-01',versionId:vocal.versionId,sourceAudioSha256:vocal.sha256}));await save();
  assert.ok(report.lyrics.available,report.lyrics.unavailableReason??'Real lyrics engine unavailable');
  service.lyricsGeneration.start(vocal.versionId,randomUUID());report.lyrics.result=await wait(()=>service.lyricsGeneration.status(vocal.versionId).job,['succeeded','failed','cancelled','interrupted'],()=>service.lyricsGeneration.cancel(vocal.versionId));
  report.lyrics.output=service.studio.lyrics(vocal.versionId);await save();
  assert.equal(report.lyrics.result.state,'succeeded',report.lyrics.result.message);
  assert.ok(report.lyrics.result.resource?.peak?.memory>0,'real lyrics workers must have measured nonzero memory');
  assert.equal(report.lyrics.output.kind,'synced');assert.ok(report.lyrics.output.lines.length>0);
 }else if(!selected||selected.includes('Q-LYRICS-01'))report.lyrics={status:'blocked',reason:'Q-MUSIC-02 has no completed real audio',humanTranscript:'pending'};
 report.generationSummary=generationSummary(report.trials,requiredKeys);report.fullGenerationSummary=generationSummary(report.trials,allRequiredKeys);report.finishedAt=new Date().toISOString();await save();
 if(!qualityExecutionPassed(report.generationSummary,!selected||selected.includes('Q-LYRICS-01'),report.lyrics?.result?.state==='succeeded'))process.exitCode=1;
}finally{try{await service.close();}finally{await awakeClock?.close();}process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);currentLog='';await save();console.log('Execution evidence: '+file);}
