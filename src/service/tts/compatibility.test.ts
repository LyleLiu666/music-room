import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompatibleSpeechDriver} from './compatibility.ts';
import {SpeechService,type SpeechDriver} from './speech.ts';
import {ProjectStore} from '../projects/store.ts';
import {encodeWav} from '../../wav.ts';
const audio=new Uint8Array(encodeWav([Float32Array.from({length:24000},(_,i)=>Math.sin(i*.1)*.1)],24000));
const context={signal:new AbortController().signal,report:()=>{},stage:()=>{}};
test('explicit reference transcript selects Breeze; absence preserves IndexTTS; failures never silently change models',async()=>{
 const calls:string[]=[];
 const make=(name:string):SpeechDriver=>({engineLabel:name,installed:()=>true,prepare:async()=>{},generate:async()=>{calls.push(name);if(name==='Breeze')throw Error('Breeze failed');}});
 const driver=createCompatibleSpeechDriver(make('Index'),make('Breeze'));
 const request={text:'正文',referencePath:'/ref.wav',outputPath:'/out.wav'};
 for(const referenceText of [undefined,'','  '])await driver.generate('/root',{...request,referenceText},context);
 await assert.rejects(driver.generate('/root',{...request,referenceText:'参考录音里的话'},context),/Breeze failed/);
 assert.deepEqual(calls,['Index','Index','Index','Breeze']);
 assert.equal(driver.select!({referenceText:'参考'}).engineName,'Breeze TTS 2');
 assert.equal(driver.select!({}).engineName,'IndexTTS 2.0');
});
test('reference transcript and actual engine persist through the service and studio history without relabeling legacy versions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'breeze-compat-')),store=await ProjectStore.open(root);let speech:SpeechService|undefined;
 const requests:any[]=[];
 const make=(name:string):SpeechDriver=>({engineLabel:name,installed:()=>true,prepare:async()=>{},generate:async(_,r)=>{requests.push({...r});writeFileSync(r.outputPath,audio);}});
 const driver=createCompatibleSpeechDriver(make('audio.cpp F16'),make('MLX 4bit'));
 try{await store.createProject('film','项目');speech=await SpeechService.open(store,driver);const voice=speech.addVoice('参考',audio),sound=await speech.createSound('film','旁白');
  const old=speech.generate({soundId:sound.id,voiceId:voice.id,text:'原来的方式'}),input={soundId:sound.id,voiceId:voice.id,text:'新方式',referenceText:'参考录音原文'};
  const fresh=speech.generate(input);input.referenceText='之后的修改';
  for(let i=0;i<200&&speech.job(fresh.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(speech.job(fresh.id).state,'succeeded');assert.equal(speech.job(old.id).engine,'IndexTTS 2.0');assert.equal(speech.job(fresh.id).engine,'Breeze TTS 2');assert.equal(speech.job(fresh.id).referenceText,'参考录音原文');assert.equal(requests[1].referenceText,'参考录音原文');
  assert.throws(()=>speech!.generate({...input,referenceText:123 as any}),/文字稿/);
  assert.throws(()=>speech!.generate({...input,referenceText:'字'.repeat(2001)}),/文字稿/);
  await speech.close();speech=await SpeechService.open(store,driver);assert.equal(speech.job(old.id).engine,'IndexTTS 2.0');assert.equal(speech.job(fresh.id).referenceText,'参考录音原文');assert.deepEqual(speech.audio(old.id),audio);
 }finally{await speech?.close();await store.close();rmSync(root,{recursive:true,force:true});}
});

test('Breeze receives the complete emotion description, while absent controls preserve pure cloning',async()=>{
 const {breezeInstruction}=await import('./breeze-runtime.ts');
 assert.equal(breezeInstruction({}),undefined);
 const emotion='不要悲伤。请保持开心，但第二句话放慢一点。';
 assert.equal(breezeInstruction({emotion}),emotion);
 assert.equal(breezeInstruction({emotion,emotionStrength:'minimal'}),emotion+'\n表达程度：情绪非常平淡。');
});

test('Breeze preparation refuses a redirected model folder before touching dependencies or foreign files',async()=>{
 const {prepareBreeze}=await import('./breeze-runtime.ts');const {checkedDirectory}=await import('./python-runtime.ts');const {mkdirSync,symlinkSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'breeze-install-')),foreign=mkdtempSync(join(tmpdir(),'breeze-foreign-'));
 try{checkedDirectory(root);mkdirSync(join(root,'breeze','model'),{recursive:true});symlinkSync(foreign,join(root,'breeze','model','audio_tokenizer'));await assert.rejects(prepareBreeze(root,context),/符号链接/);assert.equal((await import('node:fs')).readdirSync(foreign).length,0);assert.equal((await import('node:fs')).existsSync(join(root,'breeze','.venv')),false);}
 finally{rmSync(root,{recursive:true,force:true});rmSync(foreign,{recursive:true,force:true});}
});

test('Node and the pinned Bun runtime see identical inference program bytes and resource identity',async()=>{
 const {breezeProfile}=await import('./breeze-runtime.ts');const {execFileSync}=await import('node:child_process');const {resolve}=await import('node:path');
 const result=execFileSync(resolve('node_modules/.bin/bun'),['-e',"import {breezeProfile} from './src/service/tts/breeze-runtime.ts'; console.log(JSON.stringify(breezeProfile))"],{encoding:'utf8'});
 assert.deepEqual(JSON.parse(result),breezeProfile);
});
