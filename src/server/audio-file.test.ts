import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {once} from 'node:events';
import {MusicService} from '../service/service.ts';
import {testResources} from '../service/resources/testing.ts';
import {serveHttp} from './http.ts';
import {encodeWav} from '../wav.ts';

const example=JSON.parse(await readFile(new URL('../music/authoring/example.json',import.meta.url),'utf8'));
async function fixture(t:any,frames=22050){
 const root=await mkdtemp(join(tmpdir(),'artifact-stream-'));
 const service=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,undefined,undefined,undefined,testResources());
 const http=await serveHttp(service,{read:async()=>new Uint8Array(),has:()=>false,embedded:false});
 t.after(async()=>{await http.close();await service.close();await rm(root,{recursive:true,force:true});});
 await service.store.importRevision(example);
 const bytes=Buffer.from(encodeWav([Float32Array.from({length:frames},(_,i)=>Math.sin(i*.1)*.2)],22050));
 const artifact=await service.store.publishArtifact(example.work.id,example.revision.id,'render-test',bytes);
 return {root,service,http,bytes,file:service.store.path('projects',example.work.id,artifact.path),url:http.runtime.url+`/artifacts/${example.work.id}/${example.revision.id}/${artifact.id}`,headers:{authorization:`Bearer ${http.runtime.token}`}};
}

test('stored artifact range stays behind token, origin, and GET checks',async t=>{
 const f=await fixture(t);
 for(const headers of ([{range:'bytes=0-3'},{range:'bytes=0-3',authorization:'Bearer invalid'}] as Record<string,string>[])){
  const response=await fetch(f.url,{headers});assert.equal(response.status,401);assert.equal(response.headers.get('accept-ranges'),null);await response.arrayBuffer();
 }
 const forbidden=await fetch(f.url,{headers:{...f.headers,range:'bytes=0-3',origin:'https://evil.invalid'}});assert.equal(forbidden.status,403);await forbidden.arrayBuffer();
 const head=await fetch(f.url,{method:'HEAD',headers:f.headers});assert.equal(head.status,405);
});

test('stored artifact bytes=206 avoids the whole-buffer service read and keeps download headers',async t=>{
 const f=await fixture(t);let bufferedReads=0;
 t.mock.method(f.service.store,'artifact',async()=>{bufferedReads++;throw Error('whole-buffer read must not run');});
 const response=await fetch(f.url,{headers:{...f.headers,range:'bytes=3-10'}});
 assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 3-10/${f.bytes.length}`);assert.equal(response.headers.get('content-length'),'8');
 assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-disposition'),'attachment; filename="render-test.wav"');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes.subarray(3,11));assert.equal(bufferedReads,0);
});

test('stored artifact suffix, open-ended, clamped and full responses preserve exact bytes',async t=>{
 const f=await fixture(t),size=f.bytes.length;
 for(const [range,start,end] of [['bytes=-7',size-7,size-1],['bytes=44-',44,size-1],['bytes=0-999999',0,size-1],['bytes=-999999',0,size-1]] as const){
  const response=await fetch(f.url,{headers:{...f.headers,range}});assert.equal(response.status,206,range);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${size}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes.subarray(start,end+1));
 }
 const full=await fetch(f.url,{headers:f.headers});assert.equal(full.status,200);assert.equal(full.headers.get('accept-ranges'),'bytes');assert.equal(full.headers.get('content-range'),null);assert.deepEqual(Buffer.from(await full.arrayBuffer()),f.bytes);
});

test('stored artifact invalid and unsatisfiable ranges return an empty 416 with known size',async t=>{
 const f=await fixture(t);
 for(const range of [`bytes=${f.bytes.length}-`,`bytes=${f.bytes.length+1}-${f.bytes.length+2}`,'bytes=8-2','bytes=-0','bytes=','bytes=a-b','bytes=0-1,3-4','items=0-1','bytes=9007199254740992-','bytes=0-9007199254740992']){
  const response=await fetch(f.url,{headers:{...f.headers,range}});assert.equal(response.status,416,range);assert.equal(response.headers.get('content-range'),`bytes */${f.bytes.length}`);assert.equal(response.headers.get('content-length'),'0');assert.equal((await response.arrayBuffer()).byteLength,0);
 }
});

test('streamed artifact keeps identity, manifest, integrity, symlink and removed-file checks',async t=>{
 const f=await fixture(t);
 const get=async(url=f.url)=>{const response=await fetch(url,{headers:{...f.headers,range:'bytes=0-3'}});const body=await response.json();return {status:response.status,body};};
 assert.equal((await get(f.url.replace('render-test','unknown'))).status,404);
 const changed=Buffer.from(f.bytes);changed[changed.length-1]^=1;await writeFile(f.file,changed);
 assert.equal((await get()).body.code,'SOURCE_CHANGED');
 await writeFile(f.file,f.bytes.subarray(0,-1));assert.equal((await get()).body.code,'SOURCE_CHANGED');
 await rm(f.file);await symlink(join(f.root,'outside.wav'),f.file);assert.equal((await get()).body.code,'UNSAFE_PATH');await rm(f.file);
 assert.notEqual((await get()).status,200);
 const score=f.service.store.path('projects',example.work.id,'revisions',example.revision.id,'score.json');await writeFile(score,'{}');assert.equal((await get()).body.code,'SOURCE_CHANGED');
});

test('cancelled stored download releases admission so a subsequent range can finish',async t=>{
 const f=await fixture(t,2**22);
 const req=request(f.url,{headers:f.headers});req.end();
 const [response]=await once(req,'response');response.pause();const closed=once(response,'close');response.destroy();await closed;
 const next=await fetch(f.url,{headers:{...f.headers,range:'bytes=-8'},signal:AbortSignal.timeout(1500)});assert.equal(next.status,206);assert.deepEqual(Buffer.from(await next.arrayBuffer()),f.bytes.subarray(-8));
});

test('MP3 artifact export remains buffered, ignores Range, and does not alter the original',async t=>{
 const f=await fixture(t);const original=f.service.store.artifact.bind(f.service.store);let bufferedReads=0;
 t.mock.method(f.service.store,'artifact',async(...args:Parameters<typeof original>)=>{bufferedReads++;return original(...args);});
 const response=await fetch(f.url+'?format=mp3',{headers:{...f.headers,range:'bytes=0-3'}});assert.equal(response.status,200);assert.equal(response.headers.get('accept-ranges'),null);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('content-disposition'),'attachment; filename="render-test.mp3"');assert.ok((await response.arrayBuffer()).byteLength>4);assert.equal(bufferedReads,1);assert.deepEqual(await readFile(f.file),f.bytes);
});
