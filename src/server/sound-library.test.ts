import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicService} from '../service/service.ts';
import {testResources} from '../service/resources/testing.ts';
import {serveHttp} from './http.ts';
import {encodeWav} from '../wav.ts';
import {readAudioUpload} from './resource-io.ts';
import {Readable} from 'node:stream';
import type {IncomingMessage} from 'node:http';
test('audio upload bounds both declared and streamed sizes before saving',async()=>{
 const request=(chunks:Buffer[],length?:string)=>Object.assign(Readable.from(chunks),{headers:length===undefined?{}:{'content-length':length}}) as unknown as IncomingMessage;
 const signal=new AbortController().signal;assert.deepEqual(await readAudioUpload(request([Buffer.from('ab'),Buffer.from('cd')]),4,signal),Buffer.from('abcd'));
 await assert.rejects(readAudioUpload(request([Buffer.from('ab'),Buffer.from('cd')]),3,signal),{code:'TOO_LARGE'});const declared=request([Buffer.from('a')],'100');await assert.rejects(readAudioUpload(declared,4,signal),{code:'TOO_LARGE'});assert.equal(declared.readableDidRead,false);declared.destroy();
});
test('external audio is authenticated, imported once, listed even without projects, and downloadable intact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'library-http-')),service=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,undefined,undefined,undefined,testResources()),http=await serveHttp(service,{read:async()=>new Uint8Array(),has:()=>false,embedded:false});
 try{
  const wav=Buffer.from(encodeWav([new Float32Array(22050)],22050)),headers={authorization:`Bearer ${http.runtime.token}`},url=http.runtime.url+'/sound-library/import?'+new URLSearchParams({name:'测试.wav',title:'外部测试',requestId:'test'});
  assert.equal((await fetch(url,{method:'POST',body:wav})).status,401);assert.equal((await fetch(url,{headers})).status,405);
  const response=await fetch(url,{method:'POST',body:wav,headers});assert.equal(response.status,200);const item=await response.json();assert.equal(item.title,'外部测试');
  assert.equal((await(await fetch(url,{method:'POST',body:wav,headers})).json()).id,item.id);
  const data=await service.call('studio_library',{paginateConversions:true});assert.equal(data.soundLibrary.length,1);assert.equal(data.projects.length,0);
  assert.equal((await fetch(http.runtime.url+item.audioPath)).status,401);const audio=await fetch(http.runtime.url+item.audioPath,{headers});assert.equal(audio.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await audio.arrayBuffer()),wav);
  assert.equal((await fetch(http.runtime.url+'/sound-library/audio/unknown',{headers})).status,404);
  assert.equal((await fetch(url.replace('requestId=test','requestId=bad'),{method:'POST',body:Buffer.from('bad'),headers})).status,400);assert.equal((await service.call('studio_library',{})).soundLibrary.length,1);
 }finally{await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
test('saving external recordings stays available while model generation holds the execution queue',async()=>{
 const root=await mkdtemp(join(tmpdir(),'library-during-model-')),resources=testResources(),service=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,undefined,undefined,undefined,resources),http=await serveHttp(service,{read:async()=>new Uint8Array(),has:()=>false,embedded:false});
 let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);resources.register('hold',{resident:()=>undefined,unload:async()=>{}});const model=resources.run({id:'held-model',engine:'hold',demand:resources.estimate('hold',{}),execute:async()=>{entered();await hold;}});await ready;
 try{const wav=Buffer.from(encodeWav([new Float32Array(22050)],22050)),res=await fetch(http.runtime.url+'/sound-library/import?name=test.wav&requestId=during-model',{method:'POST',headers:{authorization:`Bearer ${http.runtime.token}`},body:wav,signal:AbortSignal.timeout(1500)});assert.equal(res.status,200);assert.equal(resources.snapshot().active?.id,'held-model');assert.equal(resources.snapshot().queued.length,0);assert.equal(service.soundLibrary.list().length,1);}finally{release();await model;await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
