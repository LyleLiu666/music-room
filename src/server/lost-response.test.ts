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

test('an explicitly identified speech sound can be retried after a committed response is lost, including after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lost-speech-create-'));const open=()=>MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());let service=await open(),http=await serveHttp(service,assets);
 const args={projectId:'retry-speech',title:'旁白',kind:'speech',soundId:'speech-stable-retry'};
 const request=()=>fetch(http.runtime.url+'/api/studio_create_sound',{method:'POST',headers:{authorization:`Bearer ${http.runtime.token}`,'content-type':'application/json'},body:JSON.stringify(args)});
 try{await service.call('create_project',{projectId:args.projectId,title:'旁白项目'});let saved:any,proxyError:unknown;const proxy=createServer(async(_req,res)=>{try{const response=await request();assert.equal(response.status,200);saved=await response.json();}catch(error){proxyError=error;}finally{res.destroy();}});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');try{await assert.rejects(fetch(`http://127.0.0.1:${(proxy.address() as any).port}`));if(proxyError)throw proxyError;assert.equal(saved.id,args.soundId);}finally{proxy.closeAllConnections();await new Promise<void>(r=>proxy.close(()=>r()));}
  await http.close();await service.close();service=await open();http=await serveHttp(service,assets);const retries=await Promise.all(Array.from({length:5},async()=>{const retry=await request();assert.equal(retry.status,200);return retry.json();}));assert.ok(retries.every(value=>value.id===args.soundId));assert.equal((await service.call('studio_library',{})).sounds.filter(x=>x.id===args.soundId).length,1);
  const conflict=await fetch(http.runtime.url+'/api/studio_create_sound',{method:'POST',headers:{authorization:`Bearer ${http.runtime.token}`,'content-type':'application/json'},body:JSON.stringify({...args,title:'另一个名称'})});assert.equal(conflict.status,409);
 }finally{await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('speech sound retry recovers a committed speech record after the studio index write fails',async()=>{
 const root=await mkdtemp(join(tmpdir(),'speech-index-recovery-')),service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const write=service.store.atomicJSON.bind(service.store);let failOnce=true;
 try{await service.call('create_project',{projectId:'speech-index',title:'旁白项目'});service.store.atomicJSON=(path,value)=>{if(path.endsWith('/studio.json')&&failOnce){failOnce=false;throw Error('模拟写入失败');}return write(path,value);};
  const input={projectId:'speech-index',title:'旁白',kind:'speech' as const,soundId:'speech-stable-recovery'};await assert.rejects(service.call('studio_create_sound',input),/模拟写入失败/);service.store.atomicJSON=write;
  const recovered=await service.call('studio_create_sound',input);assert.equal(recovered.id,input.soundId);const list=await service.call('studio_library',{});assert.equal(list.sounds.filter(s=>s.id===input.soundId).length,1);assert.equal(service.speech.snapshot().sounds.filter(s=>s.id===input.soundId).length,1);
  await assert.rejects(service.call('studio_create_sound',{...input,kind:'music'}),/编号|不同/);
 }finally{service.store.atomicJSON=write;await service.close();await rm(root,{recursive:true,force:true});}
});

test('a committed project effect survives a lost response, concurrent retries and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lost-effect-'));
 const driver={profile:{id:'fixture'},installed:()=>true,prepare:async()=>{},generate:async(req:{seconds:number})=>new Uint8Array(encodeWav([new Float32Array(req.seconds*8000).fill(.2)],8000))};
 const open=()=>MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources(),undefined,{effects:driver});let service=await open(),http=await serveHttp(service,assets);
 let args:{soundId:string;requestId:string;title:string;prompt:string;seconds:number};
 const request=()=>fetch(http.runtime.url+'/api/sound_effect_generate',{method:'POST',headers:{authorization:`Bearer ${http.runtime.token}`,'content-type':'application/json'},body:JSON.stringify(args)});
 try{
  await service.call('create_project',{projectId:'office',title:'办公室'});const sound=await service.call('studio_create_sound',{projectId:'office',title:'水声',kind:'effect'});args={soundId:sound.id,requestId:'effect-response-lost',title:'水声',prompt:'water flowing',seconds:3};
  let saved:any,proxyError:unknown;const proxy=createServer(async(_req,res)=>{try{const response=await request();assert.equal(response.status,200);saved=await response.json();}catch(error){proxyError=error;}finally{res.destroy();}});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  try{await assert.rejects(fetch(`http://127.0.0.1:${(proxy.address() as any).port}`));if(proxyError)throw proxyError;assert.ok(saved.id);}finally{proxy.closeAllConnections();await new Promise<void>(r=>proxy.close(()=>r()));}
  for(let i=0;i<300&&['queued','running'].includes(service.effects.get(saved.id).state);i++)await new Promise(r=>setTimeout(r,10));assert.equal(service.effects.get(saved.id).state,'succeeded');
  await http.close();await service.close();service=await open();http=await serveHttp(service,assets);
  const retries=await Promise.all(Array.from({length:5},async()=>{const response=await request();assert.equal(response.status,200);return response.json();}));assert.ok(retries.every(value=>value.id===saved.id));const data=await service.call('studio_library',{});assert.equal(data.versions.filter(v=>v.soundId===sound.id&&v.id===saved.id).length,1);assert.equal((await service.call('sound_library_page',{filter:'effects'})).total,1);
 }finally{await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
