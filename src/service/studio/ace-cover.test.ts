import test from 'node:test';
import assert from 'node:assert/strict';
import {coverLyrics,coverRequest,coverStrengths} from './ace-cover.ts';

test('cover selection uses overlapping timed lines and exposes untimed reference without guessing the range',()=>{
 const bounds={startSeconds:15,endSeconds:45};
 const base={draft:false,reference:'原歌词',lines:[]};
 assert.deepEqual(coverLyrics({...base,kind:'plain'},bounds),{kind:'plain',text:'原歌词'});
 const lines=[{start:12,end:15,text:'以前'},{start:14,end:16,text:'起点切中'},{start:40,end:47,text:'终点切中'},{start:45,end:50,text:'以后'}];
 assert.deepEqual(coverLyrics({...base,kind:'synced',lines,duration:60,revision:'abc',unresolved:[],manuallyEdited:false},bounds),{kind:'synced',text:'起点切中\n终点切中'});
});
test('cover admits a bounded clip and gives each edit strength a distinct source ratio',()=>{
 const request={requestId:'cover-one',versionId:'source-1',startSeconds:15,endSeconds:45,style:'沙哑女声',lyrics:'同样的歌词',strength:'balanced'};
 assert.ok(coverRequest.safeParse(request).success);
 for(const endSeconds of [14,24.9,76])assert.equal(coverRequest.safeParse({...request,endSeconds}).success,false);
 assert.ok(coverStrengths.close>coverStrengths.balanced&&coverStrengths.balanced>coverStrengths.bold);
});

import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout} from 'node:timers/promises';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
import {encodeWav} from '../../wav.ts';
import type {CoverDriver} from './ace-cover-runtime.ts';
import {hash} from '../projects/store.ts';

const waveform=(seconds:number)=>new Uint8Array(encodeWav([Float32Array.from({length:Math.round(seconds*48000)},(_,i)=>Math.sin(i*.01)/4)],48000));
const noMusic={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const noSpeech={installed:()=>false,prepare:async()=>{},generate:async()=>{throw Error('unused');}};
test('cover saves an immutable sibling, deduplicates requests, cancels without publishing and survives restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cover-studio-'));
 let calls=0,wait=false;
 const driver:CoverDriver={installed:()=>true,prepare:async()=>{},generate:async(bytes,_,execution)=>{
  calls++;
  assert.deepEqual(bytes,waveform(10)); // Source wave phase is restored by the fixture selection below.
  if(wait)await setTimeout(30000,undefined,{signal:execution.signal});
  return waveform(10.04);
 }};
 const open=()=>MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,noMusic,noSpeech,undefined,testResources(),undefined,undefined,driver);
 let svc=await open();
 try{
  await svc.call('create_project',{projectId:'demo',title:'演示'});
  const sound=await svc.call('studio_create_sound',{projectId:'demo',title:'原曲',kind:'music'});
  const data=JSON.parse(await readFile(join(root,'studio.json'),'utf8')),original=waveform(30);
  data.sounds[0].finalVersionId='original';
  data.versions.push({id:'original',soundId:sound.id,number:1,createdAt:new Date().toISOString(),source:{kind:'audio',id:'original'},state:'succeeded',stage:'完成',audioPath:'/studio-audio/original',audioHash:hash(original),duration:30,kept:true,deleted:false,input:{soundId:sound.id,text:'电子舞曲',lyrics:'原始歌词',instrumental:false}});
  await svc.close();
  const {mkdir,writeFile}=await import('node:fs/promises');
  await mkdir(join(root,'studio-audio'),{recursive:true});
  await writeFile(join(root,'studio-audio/original.wav'),original);
  await writeFile(join(root,'studio.json'),JSON.stringify(data));
  svc=await open();
  const request={requestId:'cover-a',versionId:'original',startSeconds:0,endSeconds:10,lyrics:'原始歌词',style:'rock',strength:'balanced' as const};
  const [a,b]=await Promise.all([svc.call('studio_cover_generate',request),svc.call('studio_cover_generate',request)]);
  assert.equal(a.id,b.id);
  await assert.rejects(svc.call('studio_cover_generate',{...request,style:'jazz'}),/不同/);
  const awaitState=async(id:string,state:string)=>{
   for(let i=0;i<100;i++){
    const v=(await svc.call('studio_library',{})).versions.find(v=>v.id===id)!;
    if(v.state===state)return v;
    if(v.state==='failed')throw Error(v.error);
    await setTimeout(10);
   }
   assert.fail(`cover did not reach ${state}`);
  };
  const saved=await awaitState(a.id,'succeeded');
  assert.equal(saved.parentId,'original');assert.equal(saved.cover?.sourceNumber,1);assert.equal(saved.duration,10);
  assert.equal(calls,1);assert.deepEqual(svc.studio.audio(a.id),waveform(10));
  wait=true;
  const pending=await svc.call('studio_cover_generate',{...request,requestId:'cover-b'});
  await awaitState(pending.id,'running');
  await svc.call('studio_cancel',{versionId:pending.id});
  assert.equal((await awaitState(pending.id,'cancelled')).audioPath,undefined);
  await svc.close();svc=await open();
  assert.deepEqual(svc.studio.audio('original'),original);
  const after=await svc.call('studio_library',{});
  assert.equal(after.sounds[0].finalVersionId,'original');assert.equal(after.versions.find(v=>v.id==='original')?.duration,30);
  assert.equal((await svc.call('studio_cover_generate',request)).id,a.id);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
