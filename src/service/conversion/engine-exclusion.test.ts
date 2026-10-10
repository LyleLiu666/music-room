import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {MusicService} from '../service.ts';import type {SpeechDriver} from '../tts/speech.ts';import type {ConversionDriver} from './conversion.ts';import {encodeWav} from '../../wav.ts';
const wav=new Uint8Array(encodeWav([new Float32Array(44100).fill(.1)],44100));
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{release,promise};}
async function wait(check:()=>boolean){for(let i=0;i<250&&!check();i++)await new Promise(r=>setTimeout(r,10));assert.ok(check());}
async function fixture(speech:Partial<SpeechDriver>={},conversion:Partial<ConversionDriver>={}){
 const root=await mkdtemp(join(tmpdir(),'conversion-exclusive-'));const svc=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,{installed:()=>true,prepare:async()=>{},generate:async(_,r)=>{await writeFile(r.outputPath,wav);},cleanReference:async(_,r)=>{await writeFile(r.outputPath,wav);},...speech},{status:()=>({ready:true,message:''}),run:async dir=>{for(const name of ['source','converted','vocals'])await writeFile(join(dir,name+'.wav'),wav);return{duration:1};},...conversion});
 await svc.call('create_project',{projectId:'film',title:'测试'});const sound=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'});const voice=svc.speech.addVoice('参考',wav);
 return{svc,sound,voice,add:()=>svc.conversion.add('song.wav',wav,{id:voice.id,name:voice.name,audio:wav},crypto.randomUUID()),close:async()=>{await svc.close();await rm(root,{recursive:true,force:true});}};
}
test('active conversion rejects direct TTS, studio TTS and all new reference cleanup before adding jobs',async()=>{
 const busy=gate();let starts=0;const f=await fixture({generate:async()=>{starts++;}}, {run:async()=>{await busy.promise;throw Error('fixture done');}});
 try{const j=f.add();await wait(()=>f.svc.conversion.get(j.id).state==='running');const request={soundId:f.sound.id,voiceId:f.voice.id,text:'你好'};
  await assert.rejects(f.svc.call('tts_generate',request),/音色转换/);await assert.rejects(f.svc.call('studio_generate',request),/音色转换/);
  assert.throws(()=>f.svc.speech.cleanVoice(f.voice.id),/音色转换/);assert.throws(()=>f.svc.speech.addVoice('清理',wav,true),/音色转换/);await assert.rejects(f.svc.speech.prepare('/unused'),/音色转换/);
  assert.equal(f.svc.speech.snapshot().versions.length,0);assert.equal(starts,0);assert.equal(f.svc.speech.snapshot().voices.length,1);
  assert.ok(f.svc.speech.addVoice('仅保存原音',wav,false));
 }finally{busy.release();await f.close();}
});
test('conversion waits for reference cleanup, and queued conversion rejects new speech without deadlock',async()=>{
 const busy=gate();let cleaning=false,converted=false;const f=await fixture({cleanReference:async(_,r)=>{cleaning=true;await busy.promise;cleaning=false;await writeFile(r.outputPath,wav);}}, {run:async()=>{assert.equal(cleaning,false);converted=true;throw Error('fixture done');}});
 try{const voice=f.svc.speech.addVoice('需要清理',wav,true);await wait(()=>cleaning);const j=f.add();assert.equal(f.svc.conversion.get(j.id).state,'queued');
  await assert.rejects(f.svc.call('tts_generate',{soundId:f.sound.id,voiceId:f.voice.id,text:'再来一句'}),/音色转换/);
  busy.release();await wait(()=>converted);assert.equal(f.svc.speech.snapshot().voices.find(v=>v.id===voice.id)?.processing?.state,'succeeded');
 }finally{busy.release();await f.close();}
});
test('existing TTS queue drains before conversion; completion restores speech admission',async()=>{
 const busy=gate(),order:string[]=[];const f=await fixture({generate:async(_,r)=>{order.push(r.text);await busy.promise;await writeFile(r.outputPath,wav);}}, {run:async dir=>{order.push('conversion');for(const name of ['source','converted','vocals'])await writeFile(join(dir,name+'.wav'),wav);return{duration:1};}});
 try{for(const text of ['first','second'])f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text});const j=f.add();assert.equal(f.svc.conversion.get(j.id).state,'queued');busy.release();await wait(()=>f.svc.conversion.get(j.id).state==='succeeded');assert.deepEqual(order,['first','second','conversion']);
  const last=f.svc.speech.generate({soundId:f.sound.id,voiceId:f.voice.id,text:'after'});await wait(()=>f.svc.speech.job(last.id).state==='succeeded');
 }finally{busy.release();await f.close();}
});
