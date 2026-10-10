import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {MusicService} from '../service.ts';import type {SpeechDriver} from '../tts/speech.ts';import type {ConversionDriver} from './conversion.ts';import {encodeWav} from '../../wav.ts';
import {testResources} from '../resources/testing.ts';
const wav=new Uint8Array(encodeWav([new Float32Array(44100).fill(.1)],44100));
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{release,promise};}
async function wait(check:()=>boolean){for(let i=0;i<250&&!check();i++)await new Promise(r=>setTimeout(r,10));assert.ok(check());}
async function fixture(speech:Partial<SpeechDriver>={},conversion:Partial<ConversionDriver>={}){
 const root=await mkdtemp(join(tmpdir(),'conversion-exclusive-'));const svc=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,{installed:()=>true,prepare:async()=>{},generate:async(_,r)=>{await writeFile(r.outputPath,wav);},cleanReference:async(_,r)=>{await writeFile(r.outputPath,wav);},...speech},{status:()=>({ready:true,message:''}),run:async dir=>{for(const name of ['source','converted','vocals'])await writeFile(join(dir,name+'.wav'),wav);return{duration:1};},...conversion},testResources());
 await svc.call('create_project',{projectId:'film',title:'测试'});const sound=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'});const voice=svc.speech.addVoice('参考',wav);
 return{svc,sound,voice,add:()=>svc.conversion.add('song.wav',wav,{id:voice.id,name:voice.name,audio:wav},crypto.randomUUID()),close:async()=>{await svc.close();await rm(root,{recursive:true,force:true});}};
}
test('active conversion queues direct TTS, studio TTS and reference cleanup without concurrent loading',async()=>{
 const busy=gate();let starts=0;const f=await fixture({generate:async()=>{starts++;}}, {run:async()=>{await busy.promise;throw Error('fixture done');}});
 try{const j=f.add();await wait(()=>f.svc.conversion.get(j.id).state==='running');const request={soundId:f.sound.id,voiceId:f.voice.id,text:'你好'};
  const direct=await f.svc.call('tts_generate',request),studio=await f.svc.call('studio_generate',request);
  assert.equal(direct.state,'queued');assert.equal(studio.state,'queued');
  const cleaned=f.svc.speech.cleanVoice(f.voice.id);assert.equal(cleaned.processing?.state,'queued');
  await new Promise<void>(r=>setImmediate(r));
  assert.equal(f.svc.speech.snapshot().versions.length,2);assert.equal(starts,0);
  await f.svc.speech.cancel(direct.id);await f.svc.call('studio_cancel',{versionId:studio.id});
  assert.ok(f.svc.speech.addVoice('仅保存原音',wav,false));
 }finally{busy.release();await f.close();}
});
test('conversion waits for reference cleanup, and new speech queues without deadlock',async()=>{
 const busy=gate();let cleaning=false,converted=false;const f=await fixture({cleanReference:async(_,r)=>{cleaning=true;await busy.promise;cleaning=false;await writeFile(r.outputPath,wav);}}, {run:async()=>{assert.equal(cleaning,false);converted=true;throw Error('fixture done');}});
 try{const voice=f.svc.speech.addVoice('需要清理',wav,true);await wait(()=>cleaning);const j=f.add();assert.equal(f.svc.conversion.get(j.id).state,'queued');
  const later=await f.svc.call('tts_generate',{soundId:f.sound.id,voiceId:f.voice.id,text:'再来一句'});assert.equal(later.state,'queued');
  busy.release();await wait(()=>converted);assert.equal(f.svc.speech.snapshot().voices.find(v=>v.id===voice.id)?.processing?.state,'succeeded');
 }finally{busy.release();await f.close();}
});
test('existing TTS queue drains before conversion; completion restores speech admission',async()=>{
 const busy=gate(),order:string[]=[];const f=await fixture({generate:async(_,r)=>{order.push(r.text);await busy.promise;await writeFile(r.outputPath,wav);}}, {run:async dir=>{order.push('conversion');for(const name of ['source','converted','vocals'])await writeFile(join(dir,name+'.wav'),wav);return{duration:1};}});
 try{for(const text of ['first','second'])f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text});const j=f.add();assert.equal(f.svc.conversion.get(j.id).state,'queued');busy.release();await wait(()=>f.svc.conversion.get(j.id).state==='succeeded');assert.deepEqual(order,['first','second','conversion']);
  const last=f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text:'after'});await wait(()=>f.svc.speech.job(last.id).state==='succeeded');
 }finally{busy.release();await f.close();}
});
test('an idle TTS resident must actually unload before conversion starts',async()=>{
 const unloaded=gate(),unloading=gate();let resident=false,converted=false;
 const f=await fixture({resident:()=>resident?{memory:1024}:undefined,unload:async()=>{unloading.release();await unloaded.promise;resident=false;},generate:async(_,r)=>{resident=true;await writeFile(r.outputPath,wav);}},
  {run:async dir=>{assert.equal(resident,false);converted=true;for(const name of ['source','converted','vocals'])await writeFile(join(dir,name+'.wav'),wav);return{duration:1};}});
 try{const speech=f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text:'resident'});await wait(()=>f.svc.speech.job(speech.id).state==='succeeded');assert.equal(resident,true);
  const conversion=f.add();await unloading.promise;assert.equal(converted,false);assert.equal(f.svc.conversion.get(conversion.id).state,'queued');
  unloaded.release();await wait(()=>f.svc.conversion.get(conversion.id).state==='succeeded');assert.equal(converted,true);
 }finally{unloaded.release();await f.close();}
});
test('shutdown cancels the shared execution signal and preserves queued work as interrupted',async()=>{
 const started=gate();const f=await fixture({generate:async(_,__,ctx)=>{started.release();await new Promise((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(ctx.signal.reason),{once:true}));}});
 try{const first=f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text:'hold'});await started.promise;const second=f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text:'queued'});
  await f.svc.close();assert.equal(f.svc.speech.job(first.id).state,'interrupted');assert.equal(f.svc.speech.job(second.id).state,'interrupted');assert.deepEqual(f.svc.resources.snapshot().reservations,{});
 }finally{await f.close();}
});
