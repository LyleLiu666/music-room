import {testResources} from '../service/resources/testing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MusicService} from '../service/service.ts';
import {serveHttp} from './http.ts';
import {encodeWav} from '../wav.ts';
import type {YuE2Driver} from '../service/yue2/engine.ts';
const unused:YuE2Driver={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw new Error('unused');}};
test('authenticated browser upload, generation, audio and speech page bootstrap use the same service',async()=>{
 const root=await mkdtemp(join(tmpdir(),'speech-http-')),bytes=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.2)],22050));
 const read=async()=>new TextEncoder().encode('<html><head></head><body></body></html>');
 const service=await MusicService.open(root,()=>{throw new Error('unused');},read,false,unused,{installed:()=>true,prepare:async()=>{},generate:async(_,req)=>{await writeFile(req.outputPath,bytes);}},undefined,testResources()),http=await serveHttp(service,{read,has:p=>p==='speech.html',embedded:false});
 try{await service.call('create_project',{projectId:'film',title:'短片'});const sound=await service.call('tts_create_sound',{projectId:'film',title:'旁白'});const url=http.runtime.url,auth={authorization:`Bearer ${http.runtime.token}`};assert.equal((await fetch(url+'/speech/voices',{method:'POST',body:bytes})).status,401);
 const uploaded=await fetch(url+'/speech/voices?cleanup=false&name='+encodeURIComponent('我的声音'),{method:'POST',headers:auth,body:bytes});assert.equal(uploaded.status,200);const voice=await uploaded.json();assert.equal(voice.name,'我的声音');assert.deepEqual(new Uint8Array(await (await fetch(url+'/speech/voice-audio/'+voice.id,{headers:auth})).arrayBuffer()),bytes);
 const v=await service.call('tts_generate',{soundId:sound.id,voiceId:voice.id,text:'欢迎回来'});for(let i=0;i<100&&service.speech.job(v.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));const response=await fetch(url+'/speech/audio/'+v.id,{headers:auth});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 assert.equal((await fetch(url+'/speech/audio/'+v.id)).status,401);assert.equal((await fetch(url+'/speech/voices',{method:'POST',headers:auth,body:'invalid'})).status,400);assert.match(await (await fetch(url+'/speech.html')).text(),/music-room-service/);
 assert.throws(()=>service.call('tts_generate',{soundId:sound.id,voiceId:voice.id,text:'你好',duration:3} as never));
 }finally{await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
