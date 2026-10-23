import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicService} from '../service/service.ts';
import {testResources} from '../service/resources/testing.ts';
import {encodeWav} from '../wav.ts';
import {serveHttp} from './http.ts';
const assets={read:async()=>new Uint8Array(),has:()=>false,embedded:false};
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('lost HTTP response after commit: import and mix retries survive restart without duplicate versions',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'lost-response-'));
 const renderer=(snapshot:any)=>({result:Promise.resolve({wav:new Uint8Array(encodeWav([new Float32Array(Math.round(snapshot.composition.score.duration*44100)),new Float32Array(Math.round(snapshot.composition.score.duration*44100))],44100)),peak:0,rms:0,attenuation:1,engine:'test'}),cancel:()=>{}});
 const open=()=>MusicService.open(root,renderer,assets.read,false,unused,undefined,undefined,testResources());
 let service=await open(),http=await serveHttp(service,assets);
 const request=(path:string,body:string|Uint8Array)=>fetch(http.runtime.url+path,{method:'POST',headers:{authorization:`Bearer ${http.runtime.token}`,'content-type':typeof body==='string'?'application/json':'application/octet-stream'},body:typeof body==='string'?body:new Uint8Array(body)});
 // Forward the complete request and consume the committed response, then sever
 // the client's TCP connection. This is not a fabricated pre-commit 503.
 const lose=async(path:string,body:string|Uint8Array)=>{
  let committed:any,error:unknown;
  const proxy=createServer(async(req,res)=>{try{const response=await request(path,body);assert.equal(response.status,200);committed=await response.json();}catch(e){error=e;}finally{res.destroy();}});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  try{await assert.rejects(fetch(`http://127.0.0.1:${(proxy.address() as any).port}`,{method:'POST'}));if(error)throw error;assert.ok(committed);return committed;}
  finally{proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
 };
 try{
  await service.store.createProject('retry','响应丢失');const sound=await service.studio.createSound({projectId:'retry',title:'原声',kind:'clip'});
  const source=await service.studio.importScore({soundId:sound.id,compositionJson:await readFile('src/music/authoring/example.json','utf8')});
  await service.studio.update({versionId:source.id,final:true});
  const wav=new Uint8Array(encodeWav([new Float32Array(8000)],8000)),path='/sound-library/import?name=tone.wav&requestId=lost-import';
  const imported=await lose(path,wav),args={versionId:source.id,requestId:'lost-mix',mix:{volume:.5}};
  const mixed=await lose('/api/studio_save_mix',JSON.stringify(args));
  await http.close();await service.close();service=await open();http=await serveHttp(service,assets);
  const repeated=await request(path,wav);assert.equal(repeated.status,200);assert.equal((await repeated.json()).id,imported.id);
  const retries=await Promise.all(Array.from({length:8},()=>request('/api/studio_save_mix',JSON.stringify(args)).then(async r=>{assert.equal(r.status,200);return r.json();})));
  assert.ok(retries.every(v=>v.id===mixed.id));
  const changed=await request('/api/studio_save_mix',JSON.stringify({...args,mix:{volume:.7}}));assert.equal(changed.status,400);
  const snapshot=await service.studio.snapshot();assert.equal(snapshot.versions.length,2);assert.equal(service.soundLibrary.list().length,1);assert.equal(snapshot.sounds[0].finalVersionId,source.id);
 }finally{await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
