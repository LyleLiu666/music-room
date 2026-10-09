import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {SpeechService,type SpeechDriver} from './speech.ts';
import {encodeWav} from '../../wav.ts';
const reference=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.2)],22050));
const waitFor=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await new Promise(r=>setTimeout(r,10));assert.ok(check());};
async function fixture(driver:SpeechDriver){const root=await mkdtemp(join(tmpdir(),'music-speech-')),store=await ProjectStore.open(root);await store.createProject('film','短片');const speech=await SpeechService.open(store,driver);return {root,store,speech,close:async()=>{await speech.close();await store.close();await rm(root,{recursive:true,force:true});}};}
const driver:SpeechDriver={installed:()=>true,prepare:async()=>{},generate:async(_dir,request)=>{await writeFile(request.outputPath,reference);}};
test('a generated seed is persisted, forwarded, and can replay a version after reopening',async()=>{
 const received:Array<number|undefined>=[];
 const traced:SpeechDriver={...driver,generate:async(_,request)=>{received.push(request.seed);await writeFile(request.outputPath,reference);}};
 const f=await fixture(traced);let reopened:SpeechService|undefined;
 try{const voice=f.speech.addVoice('参考',reference),sound=await f.speech.createSound('film','复现');
  const first=f.speech.generate({soundId:sound.id,voiceId:voice.id,text:'你好'});await waitFor(()=>f.speech.job(first.id).state==='succeeded');
  const seed=f.speech.job(first.id).seed;assert.ok(Number.isInteger(seed));assert.ok(seed!>=0&&seed!<=0xffffffff);assert.equal(received[0],seed);
  await f.speech.close();reopened=await SpeechService.open(f.store,traced);assert.equal(reopened.job(first.id).seed,seed);
  const replay=reopened.generate({soundId:sound.id,voiceId:voice.id,text:'你好',seed});await waitFor(()=>reopened!.job(replay.id).state==='succeeded');assert.equal(received[1],seed);
  for(const seed of [-1,0x100000000,1.5])assert.throws(()=>reopened!.generate({soundId:sound.id,voiceId:voice.id,text:'非法种子',seed}));
 }finally{await reopened?.close();await f.close();}
});
test('built-in voices seed an existing library, reuse identical audio, and survive restart without duplicates or lost names',async()=>{
 const f=await fixture(driver);
 try{
  const existing=f.speech.addVoice('用户已有名称',reference);
  await f.speech.close();
  const presets={...driver,builtinVoices:async()=>[{id:'official',name:'官方音色',audio:reference}]};
  const opened=await SpeechService.open(f.store,presets);
  assert.equal(opened.snapshot().voices.length,1);
  assert.equal(opened.snapshot().voices[0].id,existing.id);
  assert.equal(opened.snapshot().voices[0].builtinId,'official');
  assert.equal(opened.snapshot().voices[0].name,'用户已有名称');
  assert.deepEqual(opened.voiceAudio(existing.id),reference);
  await opened.close();
  const again=await SpeechService.open(f.store,presets);
  assert.equal(again.snapshot().voices.length,1);
  assert.equal(again.snapshot().voices[0].builtinId,'official');
  await again.close();
 }finally{await f.close();}
});
test('speech has explicit project/sound ownership, real WAV publication, immutable input and recoverable deletion',async()=>{
 const f=await fixture(driver);try{const voice=f.speech.addVoice('参考',reference),sound=await f.speech.createSound('film','旁白');await f.speech.prepare('/unused');await waitFor(()=>f.speech.status().canGenerate);
 const request={soundId:sound.id,voiceId:voice.id,text:'你好，欢迎回来。',emotion:'平静'},v=f.speech.generate(request);request.text='后来编辑';await waitFor(()=>f.speech.job(v.id).state==='succeeded');const done=f.speech.job(v.id);
 assert.equal(done.text,'你好，欢迎回来。');assert.equal(done.engine,'IndexTTS 2.0');assert.equal(done.projectId,'film');assert.equal(done.artifact?.duration,1);assert.deepEqual(f.speech.audio(done.id),reference);
 f.speech.updateVersion(done.id,{kept:true,final:true});const child=f.speech.generate({...request,parentId:done.id});await waitFor(()=>f.speech.job(child.id).state==='succeeded');assert.equal(f.speech.snapshot().sounds[0].finalVersionId,done.id);
 f.speech.updateVersion(done.id,{deleted:true});assert.equal(f.speech.snapshot().sounds[0].finalVersionId,undefined);assert.equal(f.speech.job(child.id).parentId,done.id);f.speech.updateVersion(done.id,{deleted:false});assert.equal(f.speech.job(done.id).kept,true);
 await f.speech.close();const reopened=await SpeechService.open(f.store,driver);assert.equal(reopened.snapshot().versions.length,2);assert.deepEqual(reopened.audio(done.id),reference);await reopened.close();
 }finally{await f.close();}
});

test('reference cleanup publishes only validated audio, preserves original, and reuses a favourite across projects and restart',async()=>{
 let release=()=>{};const gate=new Promise<void>(r=>release=r),cleaned=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.13)*.1)],22050));
 let referenceUsed='';const f=await fixture({...driver,cleanReference:async(_,req,ctx)=>{ctx.stage('正在去除混响');assert.deepEqual(new Uint8Array(await readFile(req.referencePath)),reference);await gate;await writeFile(req.outputPath,cleaned);},generate:async(_,req)=>{referenceUsed=req.referencePath;await writeFile(req.outputPath,reference);}});
 try{
  const voice=f.speech.addVoice('常用旁白',reference,true),sound=await f.speech.createSound('film','开场');
  await waitFor(()=>f.speech.snapshot().voices[0]?.processing?.state==='running');assert.throws(()=>f.speech.generate({soundId:sound.id,voiceId:voice.id,text:'处理中不能生成'}),/参考声音/);
  assert.deepEqual(f.speech.voiceAudio(voice.id,true),reference);assert.throws(()=>f.speech.voiceAudio(voice.id),/处理/);
  release();await waitFor(()=>f.speech.snapshot().voices[0].processing?.state==='succeeded');assert.deepEqual(f.speech.voiceAudio(voice.id),cleaned);assert.deepEqual(f.speech.voiceAudio(voice.id,true),reference);
  f.speech.updateVoice(voice.id,{name:'我的旁白',favorite:true});await f.store.createProject('second','另一个项目');const other=await f.speech.createSound('second','片尾');
  const v=f.speech.generate({soundId:other.id,voiceId:voice.id,text:'跨项目复用'});await waitFor(()=>f.speech.job(v.id).state==='succeeded');assert.deepEqual(new Uint8Array(await readFile(referenceUsed)),cleaned);
  await f.speech.close();const reopened=await SpeechService.open(f.store,driver);assert.equal(reopened.snapshot().voices[0].favorite,true);assert.equal(reopened.snapshot().voices[0].name,'我的旁白');assert.deepEqual(reopened.voiceAudio(voice.id),cleaned);await reopened.close();
 }finally{release();await f.close();}
});

test('failed cleanup stays unusable, can retry, and never replaces a legacy reference used by existing versions',async()=>{
 let fail=true;const f=await fixture({...driver,cleanReference:async(_,req)=>{if(fail)throw Error('清理模型失败');await writeFile(req.outputPath,reference);}});
 try{
  const raw=f.speech.addVoice('原来保存的声音',reference),clean=f.speech.cleanVoice(raw.id);assert.notEqual(clean.id,raw.id);
  await waitFor(()=>f.speech.snapshot().voices.find(v=>v.id===clean.id)?.processing?.state==='failed');assert.throws(()=>f.speech.voiceAudio(clean.id),/处理/);assert.deepEqual(f.speech.voiceAudio(raw.id),reference);
  fail=false;assert.equal(f.speech.cleanVoice(clean.id).id,clean.id);await waitFor(()=>f.speech.snapshot().voices.find(v=>v.id===clean.id)?.processing?.state==='succeeded');
  assert.deepEqual(f.speech.voiceAudio(raw.id),reference);assert.deepEqual(f.speech.voiceAudio(clean.id,true),reference);assert.equal((await readdir(f.store.path('speech','voices'))).some(n=>n.includes('partial')),false);
 }finally{await f.close();}
});

test('silent cleanup is rejected; service shutdown preserves original and marks unfinished cleanup for retry',async()=>{
 const silent=new Uint8Array(encodeWav([new Float32Array(22050)],22050));
 const f=await fixture({...driver,cleanReference:async(_,req)=>{await writeFile(req.outputPath,silent);}});
 try{const v=f.speech.addVoice('静音测试',reference,true);await waitFor(()=>f.speech.snapshot().voices[0].processing?.state==='failed');assert.throws(()=>f.speech.voiceAudio(v.id));assert.deepEqual(f.speech.voiceAudio(v.id,true),reference);}finally{await f.close();}
 const g=await fixture({...driver,cleanReference:async(_,req,ctx)=>{await new Promise<void>((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));await writeFile(req.outputPath,reference);}});
 try{const v=g.speech.addVoice('停止测试',reference,true);await waitFor(()=>g.speech.snapshot().voices[0].processing?.state==='running');await g.speech.close();const reopened=await SpeechService.open(g.store,driver);assert.equal(reopened.snapshot().voices[0].processing?.state,'interrupted');assert.deepEqual(reopened.voiceAudio(v.id,true),reference);assert.throws(()=>reopened.voiceAudio(v.id));await reopened.close();}finally{await g.close();}
});

test('cleanup manifest write failure cannot publish a ready voice or replace its recoverable original',async()=>{
 let release=()=>{};const gate=new Promise<void>(r=>release=r),f=await fixture({...driver,cleanReference:async(_,req)=>{await gate;await writeFile(req.outputPath,reference);}}),persist=f.store.atomicJSON.bind(f.store);
 try{
  const v=f.speech.addVoice('保存失败测试',reference,true);await waitFor(()=>f.speech.snapshot().voices[0].processing?.state==='running');f.store.atomicJSON=()=>{throw Error('disk full');};release();await waitFor(()=>f.speech.snapshot().voices[0].processing?.state==='failed');
  assert.match(f.speech.snapshot().voices[0].processing?.error??'',/disk full/);assert.throws(()=>f.speech.voiceAudio(v.id));assert.deepEqual(f.speech.voiceAudio(v.id,true),reference);
  f.store.atomicJSON=persist;await f.speech.close();const reopened=await SpeechService.open(f.store,driver);assert.equal(reopened.snapshot().voices[0].processing?.state,'failed');await reopened.close();
 }finally{release();f.store.atomicJSON=persist;await f.close();}
});
test('cancelled running work cannot publish a late result; queued work can be cancelled without running',async()=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);let calls=0;const f=await fixture({...driver,generate:async(_dir,request)=>{calls++;await gate;await writeFile(request.outputPath,reference);}});
 try{const voice=f.speech.addVoice('参考',reference),s=await f.speech.createSound('film','旁白');await f.speech.prepare('/unused');await waitFor(()=>f.speech.status().canGenerate);const a=f.speech.generate({soundId:s.id,voiceId:voice.id,text:'第一版'}),b=f.speech.generate({soundId:s.id,voiceId:voice.id,text:'第二版'});await waitFor(()=>calls===1);await f.speech.cancel(b.id);const stopping=f.speech.cancel(a.id);release();await stopping;assert.equal(f.speech.job(a.id).state,'cancelled');assert.equal(f.speech.job(b.id).state,'cancelled');assert.equal(calls,1);assert.throws(()=>f.speech.audio(a.id));
 }finally{release();await f.close();}
});
test('multiple submitted speech jobs execute in FIFO order with only one active generation',async()=>{
 const started:string[]=[],gates:(()=>void)[]=[];let active=0,peak=0;
 const f=await fixture({...driver,generate:async(_,request)=>{
  started.push(request.text);peak=Math.max(peak,++active);
  try{await new Promise<void>(resolve=>gates.push(resolve));await writeFile(request.outputPath,reference);}finally{active--;}
 }});
 try{
  const voice=f.speech.addVoice('参考',reference),s=await f.speech.createSound('film','排队旁白');
  const jobs=['第一条','第二条','第三条'].map(text=>f.speech.generate({soundId:s.id,voiceId:voice.id,text}));
  await waitFor(()=>started.length===1);assert.deepEqual(jobs.slice(1).map(v=>f.speech.job(v.id).state),['queued','queued']);
  for(let i=0;i<jobs.length;i++){
   assert.equal(started[i],jobs[i].text);gates[i]();await waitFor(()=>f.speech.job(jobs[i].id).state==='succeeded');
   if(i+1<jobs.length)await waitFor(()=>started.length===i+2);
  }
  assert.equal(peak,1);assert.deepEqual(started,jobs.map(v=>v.text));
 }finally{for(const release of gates)release();await f.close();}
});
test('reject invalid audio, missing voice, unknown project and cross-sound parents before launching',async()=>{
 const f=await fixture(driver);try{assert.throws(()=>f.speech.addVoice('bad',new Uint8Array([1,2])));await assert.rejects(f.speech.createSound('absent','旁白'));const a=await f.speech.createSound('film','甲'),b=await f.speech.createSound('film','乙');const voice=f.speech.addVoice('参考',reference);await f.speech.prepare('/unused');await waitFor(()=>f.speech.status().canGenerate);assert.throws(()=>f.speech.generate({soundId:a.id,voiceId:'absent',text:'你好'}));const v=f.speech.generate({soundId:a.id,voiceId:voice.id,text:'你好'});await waitFor(()=>f.speech.job(v.id).state==='succeeded');assert.throws(()=>f.speech.generate({soundId:b.id,voiceId:voice.id,text:'你好',parentId:v.id}));assert.throws(()=>f.speech.generate({soundId:a.id,voiceId:voice.id,text:'  '}));
 }finally{await f.close();}
});
test('audio publication is not reported successful when the version manifest cannot be saved',async()=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r),f=await fixture({...driver,generate:async(_,req)=>{await gate;await writeFile(req.outputPath,reference);}}),original=f.store.atomicJSON.bind(f.store);
 try{const voice=f.speech.addVoice('参考',reference),sound=await f.speech.createSound('film','旁白'),v=f.speech.generate({soundId:sound.id,voiceId:voice.id,text:'要保留这段话'});await waitFor(()=>f.speech.job(v.id).state==='running');f.store.atomicJSON=()=>{throw Error('disk full');};release();await waitFor(()=>f.speech.job(v.id).state==='failed');assert.match(f.speech.job(v.id).error??'',/disk full/);assert.throws(()=>f.speech.audio(v.id));f.store.atomicJSON=original;await f.speech.close();const reopened=await SpeechService.open(f.store,driver);assert.equal(reopened.job(v.id).state,'failed');await reopened.close();
 }finally{release();f.store.atomicJSON=original;await f.close();}
});
