import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioUrlCache,AUDIO_READ_LIMIT_BYTES,AUDIO_CACHE_LIMIT_BYTES,AUDIO_CACHE_LIMIT_ENTRIES} from './audio-cache.ts';

function deferred<T>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(done=>{resolve=done;});
 return {promise,resolve};
}

function objectUrls(){
 const blobs=new Map<string,Blob>(),revoked:string[]=[];let sequence=0;
 return {blobs,revoked,createObjectURL:(blob:Blob)=>{const url=`blob:audio-${++sequence}`;blobs.set(url,blob);return url;},revokeObjectURL:(url:string)=>{revoked.push(url);blobs.delete(url);}};
}

test('simultaneous loads of the same audio share one complete, reusable object URL',async()=>{
 const ready=deferred<void>(),urls=objectUrls();let reads=0;
 const bytes=new Uint8Array([1,3,5,7]);
 const cache=new AudioUrlCache({
  ...urls,activeUrls:()=>[],
  request:async()=>{reads++;await ready.promise;return new Response(bytes,{headers:{'content-type':'audio/flac'}});}
 });
 try{
  const first=cache.get('/audio/song.flac'),second=cache.get('/audio/song.flac');
  ready.resolve();const [one,two]=await Promise.all([first,second]);
  assert.equal(one,two,'both players must receive the same live object URL');
  assert.equal(await cache.get('/audio/song.flac'),one);
  assert.equal(reads,1);assert.equal(urls.blobs.size,1);
  const blob=urls.blobs.get(one)!;assert.equal(blob.type,'audio/flac');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);
 }finally{cache.dispose();}
});

test('same path with a format query is a separate audio asset',async()=>{
 const urls=objectUrls(),paths:string[]=[];
 const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:async path=>{paths.push(path);return new Response(path);}});
 try{
  const [original,mp3]=await Promise.all([cache.get('/audio/song.flac'),cache.get('/audio/song.flac?format=mp3')]);
  assert.notEqual(original,mp3);assert.deepEqual(paths,['/audio/song.flac','/audio/song.flac?format=mp3']);
  assert.equal(await urls.blobs.get(mp3)!.text(),'/audio/song.flac?format=mp3');
 }finally{cache.dispose();}
});

for(const failure of ['network','http','body','empty','url'] as const)test(`concurrent ${failure} failure is shared and the next user read can retry`,async()=>{
 const ready=deferred<void>(),urls=objectUrls();let attempts=0,creates=0;
 const cache=new AudioUrlCache({
  ...urls,activeUrls:()=>[],
  createObjectURL:blob=>{if(failure==='url'&&++creates===1)throw Error('object URL failed');return urls.createObjectURL(blob);},
  request:async()=>{
   const attempt=++attempts;await ready.promise;
   if(attempt===1){
    if(failure==='network')throw Error('network failed');
    if(failure==='http')return new Response('unavailable',{status:503});
    if(failure==='body')return new Response(new ReadableStream({start(controller){controller.error(Error('body failed'));}}));
    if(failure==='empty')return new Response();
   }
   return new Response('retry audio');
  }
 });
 try{
  const first=cache.get('/audio/retry.wav'),second=cache.get('/audio/retry.wav');
  const results=Promise.allSettled([first,second]);ready.resolve();
  const settled=await results;
  assert.deepEqual(settled.map(result=>result.status),['rejected','rejected']);
  const retry=await cache.get('/audio/retry.wav');
  assert.equal(await urls.blobs.get(retry)!.text(),'retry audio');
  assert.equal(attempts,2,'only the later explicit read starts a new request');
  assert.equal(urls.blobs.size,1);
 }finally{cache.dispose();}
});

test('authenticated transport keeps its receiver and exact path, and never calls Response.blob',async()=>{
 const urls=objectUrls(),calls:{path:string;init:RequestInit}[]=[];
 const transport={token:'secret',async request(path:string,init:RequestInit){
  assert.equal(this.token,'secret');calls.push({path,init});
  const response=new Response(new Uint8Array([2,4]),{headers:{'content-type':'audio/wav'}});
  response.blob=async()=>{throw Error('browser disk quota');};return response;
 }};
 const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:(path,init)=>transport.request(path,init)});
 try{
  const url=await cache.get('/audio/a%20b.wav?format=mp3');
  assert.equal(calls[0].path,'/audio/a%20b.wav?format=mp3');
  assert.equal(calls[0].init.signal?.aborted,false);
  assert.deepEqual(new Uint8Array(await urls.blobs.get(url)!.arrayBuffer()),new Uint8Array([2,4]));
 }finally{cache.dispose();}
});

test('the fixed read cap cancels declared and streamed overflow without creating an object URL',async()=>{
 assert.equal(AUDIO_READ_LIMIT_BYTES,120_000_000);
 for(const declared of [true,false]){
  const urls=objectUrls();let cancelled=false;
  const chunk=new Uint8Array(8*1048576);
  const response=new Response(new ReadableStream({pull(controller){controller.enqueue(chunk);},cancel(){cancelled=true;}}),{headers:declared?{'content-length':String(AUDIO_READ_LIMIT_BYTES+1)}:{}});
  const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:async()=>response});
  try{
   await assert.rejects(cache.get('/audio/oversized.wav'),/超出/);
   assert.equal(cancelled,true);assert.equal(urls.blobs.size,0);assert.equal(response.body?.locked,false);
  }finally{cache.dispose();}
 }
});

test('six-entry LRU promotes a reused URL instead of evicting it',async()=>{
 assert.equal(AUDIO_CACHE_LIMIT_ENTRIES,6);
 const urls=objectUrls(),reads=new Map<string,number>();
 const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:async path=>{reads.set(path,(reads.get(path)??0)+1);return new Response(path);}});
 try{
  const first=await cache.get('a'),second=await cache.get('b');
  for(const path of ['c','d','e','f'])await cache.get(path);
  assert.equal(await cache.get('a'),first);await cache.get('g');
  assert.deepEqual(urls.revoked,[second]);assert.equal(urls.blobs.size,6);
  assert.equal(await cache.get('a'),first);assert.equal(reads.get('a'),1);
  assert.notEqual(await cache.get('b'),second);assert.equal(reads.get('b'),2);
 }finally{cache.dispose();}
});

test('64 MiB byte budget preserves attached audio and purge resets byte accounting',async()=>{
 assert.equal(AUDIO_CACHE_LIMIT_BYTES,64*1048576);
 const urls=objectUrls(),active=new Set<string>();
 const cache=new AudioUrlCache({...urls,activeUrls:()=>active,request:async path=>new Response(new Uint8Array(path==='small'?1:16*1048576))});
 try{
  const first=await cache.get('a');active.add(first);const second=await cache.get('b');
  for(const path of ['c','d'])await cache.get(path);
  assert.deepEqual(urls.revoked,[],'exactly 64 MiB is permitted');
  await cache.get('small');assert.deepEqual(urls.revoked,[second]);assert.equal(urls.blobs.has(first),true);
  cache.releaseUnused();assert.deepEqual([...urls.blobs.keys()],[first]);
  for(const path of ['e','f','g'])await cache.get(path);
  assert.equal(urls.blobs.size,4,'released bytes must not count toward the fresh 64 MiB budget');
  assert.equal(await cache.get('a'),first);
 }finally{cache.dispose();}
});

test('attached active players and the newest URL are not revoked to force the LRU limit',async()=>{
 const urls=objectUrls(),active=new Set<string>();
 const cache=new AudioUrlCache({...urls,activeUrls:()=>active,request:async path=>new Response(path)});
 try{
  for(let i=0;i<7;i++)active.add(await cache.get(String(i)));
  assert.equal(urls.blobs.size,7);assert.deepEqual(urls.revoked,[]);
  cache.releaseUnused();assert.deepEqual(urls.revoked,[]);
  const released=[...active][0];active.delete(released);await cache.get('fresh');
  assert.deepEqual(urls.revoked,[released]);assert.equal(urls.blobs.size,7);
 }finally{cache.dispose();}
});

test('purge invalidates a pending read and its late completion cannot replace a new same-path read',async()=>{
 const old=deferred<Response>(),fresh=deferred<Response>(),started=deferred<void>(),urls=objectUrls();
 let reads=0,cancelled=false;const signals:(AbortSignal|null|undefined)[]=[];
 const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:async(_path,init)=>{
  signals.push(init.signal);if(++reads===1){started.resolve();return old.promise;}return fresh.promise;
 }});
 try{
  const pending=cache.get('/audio/deleted.wav'),rejected=assert.rejects(pending,{name:'AbortError'});await started.promise;
  cache.invalidate('/audio/deleted.wav');assert.equal(signals[0]?.aborted,true);
  const replacement=cache.get('/audio/deleted.wav');
  old.resolve(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}})));
  await rejected;assert.equal(cancelled,true);assert.equal(urls.blobs.size,0);
  const joined=cache.get('/audio/deleted.wav');fresh.resolve(new Response('fresh audio'));
  const [one,two]=await Promise.all([replacement,joined]);
  assert.equal(one,two);assert.equal(reads,2);assert.equal(await cache.get('/audio/deleted.wav'),one);
  assert.equal(await urls.blobs.get(one)!.text(),'fresh audio');
 }finally{cache.dispose();}
});

for(const lifecycle of ['invalidate','dispose'] as const)test(`${lifecycle} during body consumption cannot publish a stale URL`,async()=>{
 const urls=objectUrls(),started=deferred<void>();let stream!:ReadableStreamDefaultController<Uint8Array>;
 const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:async()=>new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(new Uint8Array([1]));started.resolve();}}))});
 try{
  const pending=cache.get('slow'),rejected=assert.rejects(pending,{name:'AbortError'});await started.promise;
  // The injected body intentionally ignores AbortSignal, exercising the late-read guard.
  await Promise.resolve();if(lifecycle==='invalidate')cache.invalidate('slow');else cache.dispose();stream.enqueue(new Uint8Array([2]));stream.close();
  await rejected;assert.equal(urls.blobs.size,0);assert.deepEqual(urls.revoked,[]);
 }finally{cache.dispose();}
});

test('dispose revokes every owned URL once, cancels pending transport and prevents further reads',async()=>{
 const urls=objectUrls(),late=deferred<Response>(),started=deferred<void>(),active=new Set<string>();let reads=0,signal:AbortSignal|null|undefined;
 const cache=new AudioUrlCache({...urls,activeUrls:()=>active,request:async(path,init)=>{
  reads++;if(path==='late'){signal=init.signal;started.resolve();return late.promise;}return new Response(path);
 }});
 try{
  const one=await cache.get('one');active.add(one);const two=await cache.get('two');
  const pending=cache.get('late'),rejected=assert.rejects(pending,{name:'AbortError'});await started.promise;
  cache.dispose();cache.dispose();assert.equal(signal?.aborted,true);assert.deepEqual(urls.revoked,[one,two]);
  late.resolve(new Response('late audio'));await rejected;
  await assert.rejects(cache.get('one'),{name:'AbortError'});assert.equal(reads,3);assert.equal(urls.blobs.size,0);
 }finally{cache.dispose();}
});

test('unused URL cleanup preserves unrelated pending playback; explicit invalidation cancels only its own path',async()=>{
 const urls=objectUrls(),ready=deferred<void>();const cache=new AudioUrlCache({...urls,activeUrls:()=>[],request:async()=>{await ready.promise;return new Response('audio');}});
 try{const kept=cache.get('/kept'),deleted=cache.get('/deleted').catch(e=>e.name);await Promise.resolve();cache.releaseUnused();cache.invalidate('/deleted');ready.resolve();assert.match(await kept,/^blob:/);assert.equal(await deleted,'AbortError');}finally{cache.dispose();}
});
