import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {SpeechService} from './speech.ts';
import {ResourceCoordinator} from '../resources/coordinator.ts';
import {ResourceLease} from '../resources/lease.ts';
import {readFile} from 'node:fs/promises';
test('speech completion waits for resource release; failed cleanup cannot publish success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resource-settle-')),store=await ProjectStore.open(join(root,'workspace'));let entered!:()=>void,release!:()=>void;const unloading=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);let fail=false;
 const resources=new ResourceCoordinator({lease:new ResourceLease(join(root,'lease')),policy:{reserveFraction:0,reserveMinimum:0,headroom:0,maxSnapshotAgeMs:1000,maxWaitMs:100,retryMs:1,maxQueue:10},probe:async()=>({supported:true,topology:'cpu',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:1e9,available:1e9,owned:0}]}),estimate:()=>({verified:true,peak:{memory:1e6}})});
 const wav=await readFile('public/tts-presets/official.wav'),speech=await SpeechService.open(store,{installed:()=>true,prepare:async()=>{},generate:async(_,request)=>{await writeFile(request.outputPath,wav);fail=true;},unload:async()=>{if(fail){entered();await hold;throw Error('release failed');}}},()=>false,resources);
 try{await store.createProject('test','test','');const sound=await speech.createSound('test','test'),voice=speech.addVoice('test',wav),job=speech.generate({soundId:sound.id,voiceId:voice.id,text:'你好'});await unloading;assert.equal(speech.job(job.id).state,'running');release();for(let i=0;i<100&&speech.job(job.id).state==='running';i++)await new Promise(r=>setTimeout(r,5));assert.equal(speech.job(job.id).state,'failed');assert.equal(speech.job(job.id).artifact,undefined);}
 finally{release();await speech.close();await resources.close().catch(()=>{});await store.close();await rm(root,{recursive:true,force:true});}
});
