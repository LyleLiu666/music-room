import {ResourceLease} from '../resources/lease.ts';
import {ResourceCoordinator} from '../resources/coordinator.ts';
import {testResources} from '../resources/testing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicService} from '../service.ts';
import {encodeWav} from '../../wav.ts';
import {wavInfo} from '../tts/speech.ts';
import {hash} from '../projects/store.ts';
import {serveHttp} from '../../server/http.ts';

const wav=new Uint8Array(encodeWav([Float32Array.from({length:24000*2},(_,i)=>.3*Math.sin(2*Math.PI*440*i/24000))],24000));
const music={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const speech={installed:()=>true,prepare:async()=>{},generate:async(_:string,r:{outputPath:string})=>writeFile(r.outputPath,wav)};
const open=(root:string)=>MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,music,speech,undefined,testResources());

test('saving 0.8 speed makes durable independent audio, preserves pitch and original, and supports version lifecycle',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-speed-'));let service=await open(root);
 try{
  await service.call('create_project',{projectId:'speed',title:'语速'});
  const sound=await service.call('studio_create_sound',{projectId:'speed',title:'旁白',kind:'speech'});
  const voice=await service.call('tts_add_voice',{cleanup:false,name:'参考',audioBase64:Buffer.from(wav).toString('base64')});
  const original=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'原始正文'});
  for(let i=0;i<100&&service.speech.job(original.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));
  await service.call('studio_update_version',{versionId:original.id,final:true,kept:true});
  const args={versionId:original.id,rate:.8,requestId:'slow-first'};
  const atomic=service.store.atomicJSON.bind(service.store);
  service.store.atomicJSON=(path,value)=>{if(path.endsWith('speech/library.json'))throw Error('模拟磁盘写入失败');atomic(path,value);};
  try{await assert.rejects(service.call('studio_save_speed',args),/磁盘/);}finally{service.store.atomicJSON=atomic;}
  assert.equal((await readdir(join(root,'speech','audio'))).length,1,'unpublished speech audio is cleaned up');
  const saved=await service.call('studio_save_speed',args);
  assert.notEqual(saved.id,original.id);assert.equal(saved.parentId,original.id);assert.equal(saved.number,2);
  assert.equal(saved.speed?.rate,.8);assert.equal(saved.input?.text,'原始正文');assert.equal(saved.kept,false);
  assert.ok(Math.abs(saved.duration!-2.5)<.002);
  const audio=service.speech.audio(saved.id),info=wavInfo(audio);assert.equal(info.sampleRate,24000);
  // A resampling-only implementation would lower 440 Hz to 352 Hz.
  const pcm=Buffer.from(audio);let crossings=0;
  for(let i=24000/2;i<24000*1.5;i++)if(pcm.readInt16LE(44+i*2)>=0&&pcm.readInt16LE(44+(i-1)*2)<0)crossings++;
  assert.ok(Math.abs(crossings-440)<3,`pitch remains 440 Hz, got ${crossings}`);
  assert.equal(hash(service.speech.audio(original.id)),hash(wav));
  assert.equal((await service.call('studio_save_speed',args)).id,saved.id,'request retries do not create extra versions');
  await assert.rejects(service.call('studio_save_speed',{...args,rate:1.2}),/请求/);
  for(const rate of [0,.49,2.01,NaN,Infinity,1])await assert.rejects(async()=>service.call('studio_save_speed',{...args,rate,requestId:'invalid'}));
  const library=await service.call('studio_library',{});assert.equal(library.versions.length,2);assert.equal(library.sounds[0].finalVersionId,original.id);
  await service.close();service=await open(root);
  assert.equal(hash(service.speech.audio(saved.id)),hash(audio));
  await service.call('studio_update_version',{versionId:saved.id,final:true});
  await service.call('studio_update_version',{versionId:original.id,deleted:true});
  await service.call('studio_purge',{kind:'version',id:original.id});
  assert.equal(hash(service.speech.audio(saved.id)),hash(audio),'derived file survives removal of its source');
  const next=await service.call('studio_save_speed',{versionId:saved.id,rate:1.25,requestId:'second-edit'});
  assert.equal(next.number,3);assert.ok(Math.abs(next.duration!-2)<.002);
  await service.call('studio_update_version',{versionId:saved.id,deleted:true});
  await assert.rejects(service.call('studio_save_speed',{versionId:saved.id,rate:.8,requestId:'trash'}),/音频|回收站/);
  await service.call('studio_update_version',{versionId:saved.id,deleted:false});
  await service.call('studio_update_sound',{soundId:sound.id,deleted:true});
  await service.call('studio_purge',{kind:'sound',id:sound.id});
  assert.equal((await service.call('studio_library',{})).versions.length,0);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('FLAC music speed versions own WAV files, protected downloads, metadata and independent lifecycle',async()=>{
 const root=await mkdtemp(join(tmpdir(),'music-speed-'));let service=await open(root);
 const flac=new Uint8Array(await readFile(new URL('./fixtures/tone-440hz.flac',import.meta.url)));
 const jobs=[{id:'a'.repeat(32),status:'done',kind:'create'}];
 const connect=()=>{
  service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'ready',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
  service.yue2Client.list=async()=>({jobs:[]});// only the explicitly generated version is imported
  service.yue2Client.generate=async()=>({job:jobs[0]}) as any;
  service.yue2Client.audio=async()=>flac;
 };connect();
 let http:Awaited<ReturnType<typeof serveHttp>>|undefined;
 try{
  await service.call('create_project',{projectId:'song',title:'音乐'});
  const sound=await service.call('studio_create_sound',{projectId:'song',title:'旋律',kind:'music'});
  const original=await service.call('studio_generate',{soundId:sound.id,text:'纯音乐',instrumental:true});
  const args={versionId:original.id,rate:.8,requestId:'music-slow'};
  const saved=await service.call('studio_save_speed',args),audio=service.studio.audio(saved.id);
  assert.ok(Math.abs(wavInfo(audio).duration-2.5)<.002);assert.equal(saved.source.kind,'audio');
  assert.equal((await service.call('studio_save_speed',args)).id,saved.id);
  await service.call('studio_update_version',{versionId:saved.id,final:true,kept:true});
  const staging=join(root,'studio-audio','speed-12345678-1234-1234-1234-123456789abc.partial.wav');await writeFile(staging,wav);
  await service.close();service=await open(root);connect();await assert.rejects(readFile(staging),{code:'ENOENT'});
  assert.equal(hash(service.studio.audio(saved.id)),hash(audio));
  assert.equal((await service.call('studio_library',{})).sounds[0].finalVersionId,saved.id);
  http=await serveHttp(service,{read:async()=>new Uint8Array(),has:()=>false,embedded:false});
  assert.equal((await fetch(http.runtime.url+saved.audioPath)).status,401);
  const response=await fetch(http.runtime.url+saved.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});
  assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(hash(new Uint8Array(await response.arrayBuffer())),hash(audio));
  await service.call('studio_update_version',{versionId:saved.id,deleted:true});
  await service.call('studio_purge',{kind:'version',id:saved.id});
  await assert.rejects(readFile(join(root,'studio-audio',`${saved.id}.wav`)),{code:'ENOENT'});
  assert.equal(hash(await service.yue2Client.audio(original.source.id)),hash(flac));
  const atomic=service.store.atomicJSON.bind(service.store);
  service.store.atomicJSON=(path,value)=>{if(path.endsWith('studio.json'))throw Error('模拟磁盘写入失败');atomic(path,value);};
  try{await assert.rejects(service.call('studio_save_speed',{...args,requestId:'failed-write'}),/磁盘/);}finally{service.store.atomicJSON=atomic;}
  assert.equal((await readdir(join(root,'studio-audio'))).length,0,'unpublished music audio is cleaned up');
  const corrupt=await service.call('studio_save_speed',{...args,requestId:'detect-corruption'});
  await writeFile(join(root,'studio-audio',`${corrupt.id}.wav`),wav);
  assert.throws(()=>service.studio.audio(corrupt.id),/外部修改/);
  service.yue2Client.audio=async()=>new Uint8Array([1,2,3]);
  const before=(await service.call('studio_library',{})).versions.length;
  await assert.rejects(service.call('studio_save_speed',{...args,requestId:'bad-audio'}));
  assert.equal((await service.call('studio_library',{})).versions.length,before,'processing failure never publishes a partial version');
 }finally{await http?.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('queued speed leaves library responsive, protects source, cancels without publishing and deduplicates concurrent retries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'speed-queue-')),service=await open(root);t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 await service.call('create_project',{projectId:'p',title:'p'});const sound=await service.call('studio_create_sound',{projectId:'p',title:'s',kind:'speech'}),voice=await service.call('tts_add_voice',{cleanup:false,name:'v',audioBase64:Buffer.from(wav).toString('base64')});
 const v=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'text'});for(let i=0;i<100&&service.speech.job(v.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,5));
 service.resources.register('held',{resident:()=>undefined,unload:async()=>{}});const controller=new AbortController();const held=service.resources.run({id:'held',engine:'held',signal:controller.signal,demand:{verified:true,peak:{memory:1}},execute:ctx=>new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}))}).catch(()=>{});
 const args={versionId:v.id,rate:.8,requestId:'queued'},a=service.call('studio_save_speed',args),b=service.call('studio_save_speed',args);const results=Promise.allSettled([a,b]);
 await new Promise(r=>setTimeout(r,20));assert.equal((await service.call('studio_library',{})).versions.length,1);assert.equal(service.resources.snapshot().queued.filter(q=>q.engine==='speed').length,1);
 await assert.rejects(service.call('studio_update_version',{versionId:v.id,deleted:true}),/取消/);await service.call('studio_cancel',{versionId:v.id});assert.ok((await results).every(r=>r.status==='rejected'));assert.equal((await service.call('studio_library',{})).versions.length,1);controller.abort();await held;
});

test('speed publication waits for execution release; cleanup failure leaves no completed version or orphan file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'speed-release-')),lease=new ResourceLease(join(root,'lease')),release=lease.release.bind(lease);let failRelease=false;
 lease.release=()=>{if(failRelease)throw Error('模拟释放失败');release();};
 const resources=new ResourceCoordinator({policy:testResources().snapshot().policy,lease,estimate:()=>({verified:true,peak:{memory:256*2**20}}),probe:async()=>({supported:true,topology:'cpu',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:16*2**30,available:12*2**30,owned:2**30}]})});
 const service=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,music,speech,undefined,resources);
 try{await service.call('create_project',{projectId:'p',title:'p'});const sound=await service.call('studio_create_sound',{projectId:'p',title:'s',kind:'speech'}),voice=await service.call('tts_add_voice',{cleanup:false,name:'v',audioBase64:Buffer.from(wav).toString('base64')});const original=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'text'});for(let i=0;i<100&&service.speech.job(original.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,5));assert.equal(service.speech.job(original.id).state,'succeeded');
 failRelease=true;await assert.rejects(service.call('studio_save_speed',{versionId:original.id,rate:.8,requestId:'release-failure'}),/释放失败/);assert.equal((await service.call('studio_library',{})).versions.length,1);assert.equal((await readdir(join(root,'speech','audio'))).length,1);assert.equal((await readdir(join(root,'studio-audio'))).length,0);
 }finally{failRelease=false;await service.close();release();await rm(root,{recursive:true,force:true});}
});
