import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
import {encodeWav} from '../../wav.ts';
import {decodeAudio} from './decode-audio.ts';
import type {EffectDriver} from './sound-effects.ts';

const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const audio=(seconds:number)=>Buffer.from(encodeWav([Float32Array.from({length:seconds*8000},(_,i)=>.25+.05*Math.sin(i*.01))],8000));
const driver:EffectDriver={profile:{id:'fixture'},installed:()=>true,prepare:async()=>{},generate:async(req,execution,peak)=>{execution.signal.throwIfAborted();peak(123456);return audio(req.seconds);}};
const open=(root:string)=>MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,undefined,undefined,testResources(),undefined,driver);
const call=(service:MusicService,name:string,args:unknown):Promise<any>=>(service.call as any)(name,args);
async function waitForEffect(service:MusicService,id:string){for(let i=0;i<300;i++){const job=await call(service,'sound_effect_job',{jobId:id});if(!['queued','running'].includes(job.state))return job;await new Promise(r=>setTimeout(r,10));}throw Error('音效任务没有结束');}

test('a project effect keeps versions, source, listening decisions and one library entry per result across restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-effects-'));let service=await open(root);
 try{
  await call(service,'create_project',{projectId:'office',title:'办公室'});
  const sound=await call(service,'studio_create_sound',{projectId:'office',title:'水桶咕噜',kind:'effect'});
  const firstRequest={requestId:'effect-version-one',title:'水桶咕噜',prompt:'Water cooler bubbles',seconds:3,seed:11,soundId:sound.id};
  const first=await call(service,'sound_effect_generate',firstRequest);const retries=await Promise.all(Array.from({length:5},()=>call(service,'sound_effect_generate',firstRequest)));assert.ok(retries.every(job=>job.id===first.id));const completed=await waitForEffect(service,first.id);assert.equal(completed.state,'succeeded');
  const second=await call(service,'sound_effect_generate',{...firstRequest,requestId:'effect-version-two',seed:12,parentId:first.id});assert.equal((await waitForEffect(service,second.id)).state,'succeeded');
  let snapshot=await call(service,'studio_library',{}),versions=snapshot.versions.filter((v:any)=>v.soundId===sound.id);
  assert.deepEqual(versions.map((v:any)=>v.number),[1,2]);assert.equal(versions[0].source.kind,'sound-effect');assert.equal(versions[1].parentId,first.id);
  assert.equal(versions[0].input.text,'Water cooler bubbles');assert.equal(versions[0].input.effectSeconds,3);assert.equal(versions[0].input.seed,11);
  assert.deepEqual(await service.studio.audio(first.id),audio(3));
  await call(service,'studio_update_version',{versionId:first.id,final:true});
  const items=await call(service,'sound_library_page',{filter:'effects'});assert.equal(items.total,2);assert.equal(new Set(items.items.map((x:any)=>x.id)).size,2);assert.ok(items.items.every((x:any)=>x.item.projectId==='office'&&x.item.soundKind==='effect'));
  await service.close();service=await open(root);snapshot=await call(service,'studio_library',{});versions=snapshot.versions.filter((v:any)=>v.soundId===sound.id);
  assert.equal(versions.length,2);assert.equal(snapshot.sounds.find((s:any)=>s.id===sound.id).finalVersionId,first.id);assert.deepEqual(await service.studio.audio(first.id),audio(3));
  await call(service,'studio_update_version',{versionId:first.id,deleted:true});assert.equal((await call(service,'sound_library_page',{filter:'effects'})).total,1);await assert.rejects(async()=>service.studio.audio(first.id),/回收|删除|音频/);await assert.rejects(()=>service.studio.libraryAudio(completed.item.id),/回收|删除/);await assert.rejects(()=>call(service,'sound_library_trim',{itemId:completed.item.id,startSeconds:0,endSeconds:1,requestId:'hidden-copy'}),/项目/);
  await call(service,'studio_purge',{kind:'version',id:first.id});const jobs=JSON.parse(await readFile(join(root,'sound-effects','jobs.json'),'utf8'));assert.notEqual(jobs.jobs.find((j:any)=>j.id===first.id).request.prompt,firstRequest.prompt);await service.close();service=await open(root);snapshot=await call(service,'studio_library',{});assert.ok(!snapshot.versions.some((v:any)=>v.id===first.id));assert.equal((await call(service,'sound_library_page',{filter:'effects'})).total,1);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('a committed effect job recovers its project version if the studio index write fails',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-effect-recover-'));let service=await open(root);
 try{
  await call(service,'create_project',{projectId:'office',title:'办公室'});const sound=await call(service,'studio_create_sound',{projectId:'office',title:'水声',kind:'effect'});
  const request={requestId:'effect-recover',title:'水声',prompt:'Water flowing',seconds:3,seed:9,soundId:sound.id};
  const atomic=service.store.atomicJSON.bind(service.store);let failed=false;
  service.store.atomicJSON=((path:string,value:unknown)=>{if(path.endsWith('/studio.json')&&!failed){failed=true;throw Error('模拟索引写入失败');}return atomic(path,value);}) as typeof service.store.atomicJSON;
  await assert.rejects(()=>call(service,'sound_effect_generate',request),/模拟索引写入失败/);service.store.atomicJSON=atomic;
  const job=await call(service,'sound_effect_generate',request);assert.equal((await waitForEffect(service,job.id)).state,'succeeded');
  await service.close();service=await open(root);const snapshot=await call(service,'studio_library',{});assert.equal(snapshot.versions.filter((v:any)=>v.id===job.id&&v.soundId===sound.id).length,1);assert.equal((await call(service,'sound_library_page',{filter:'effects'})).total,1);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('trimming a project effect creates a smooth independent child version and keeps the original',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-effect-trim-'));let service=await open(root);
 try{
  await call(service,'create_project',{projectId:'office',title:'办公室'});const sound=await call(service,'studio_create_sound',{projectId:'office',title:'水声',kind:'effect'});
  const job=await call(service,'sound_effect_generate',{requestId:'effect-trim-source',title:'水声',prompt:'Water flow',seconds:3,seed:3,soundId:sound.id});assert.equal((await waitForEffect(service,job.id)).state,'succeeded');await call(service,'studio_library',{});
  const request={versionId:job.id,startSeconds:1,endSeconds:3,fadeInMs:30,fadeOutMs:30,requestId:'trim-version'};
  const trimmed=await call(service,'studio_trim_audio',request);assert.equal((await call(service,'studio_trim_audio',request)).id,trimmed.id);assert.equal(trimmed.parentId,job.id);assert.equal(trimmed.duration,2);
  const decoded=await decodeAudio(await service.studio.audio(trimmed.id));assert.equal(decoded.sampleRate,8000);assert.equal(decoded.channelData[0].length,16000);assert.ok(Math.abs(decoded.channelData[0][0])<.001);assert.ok(Math.abs(decoded.channelData[0].at(-1)!)<.001);assert.ok(decoded.channelData[0][4000]>.1);
  assert.deepEqual(await service.studio.audio(job.id),audio(3));await assert.rejects(()=>call(service,'studio_trim_audio',{...request,startSeconds:2,endSeconds:1,requestId:'invalid-trim'}));await assert.rejects(()=>call(service,'studio_trim_audio',{...request,endSeconds:3.00001,requestId:'beyond-end'}));
  await assert.rejects(()=>call(service,'studio_trim_audio',{...request,endSeconds:2}));await service.close();service=await open(root);assert.equal((await call(service,'studio_library',{})).versions.find((v:any)=>v.id===trimmed.id).duration,2);assert.equal((await call(service,'sound_library_page',{filter:'effects'})).total,2);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('an existing independent recording can be trimmed smoothly without changing its original',async()=>{
 const root=await mkdtemp(join(tmpdir(),'library-effect-trim-'));const service=await open(root);
 try{
  const original=await service.soundLibrary.import({name:'bubble.wav',title:'咕噜',requestId:'old-bubble',bytes:audio(3)});
  const request={itemId:original.id,startSeconds:0,endSeconds:1,fadeInMs:30,fadeOutMs:30,requestId:'library-trim'};
  const item=await call(service,'sound_library_trim',request);assert.equal(item.duration,1);assert.equal((await call(service,'sound_library_trim',request)).id,item.id);assert.deepEqual(await service.soundLibrary.audio(original.id),audio(3));
  const decoded=await decodeAudio(await service.soundLibrary.audio(item.id));assert.equal(decoded.channelData[0].length,8000);assert.ok(Math.abs(decoded.channelData[0][0])<.001);assert.ok(Math.abs(decoded.channelData[0].at(-1)!)<.001);
  await assert.rejects(()=>call(service,'sound_library_trim',{...request,endSeconds:2}));
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('an independent sound can be added to a project without duplicating its library row or breaking playlists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'attach-effect-'));let service=await open(root);
 try{
  const source=await service.soundLibrary.import({name:'bubble.wav',title:'饮水机咕噜',requestId:'attach-source',bytes:audio(3)});
  await call(service,'create_project',{projectId:'office',title:'办公室'});await call(service,'sound_playlist_save',{id:'playlist-one',title:'原始素材',revision:0,ids:[source.id]});
  const request={itemId:source.id,projectId:'office',title:'饮水机咕噜',requestId:'attach-effect'};
  const attached=await call(service,'studio_attach_sound',request),retry=await call(service,'studio_attach_sound',request);assert.equal(retry.id,attached.id);assert.equal(attached.source.kind,'library');
  let snapshot=await call(service,'studio_library',{});assert.equal(snapshot.sounds.find((s:any)=>s.id===attached.soundId).kind,'effect');assert.equal(snapshot.versions.filter((v:any)=>v.id===attached.id).length,1);
  let library=await call(service,'sound_library_page',{});assert.equal(library.total,1);assert.equal(library.items[0].id,attached.id);assert.equal((await call(service,'sound_library_queue',{playlistId:'playlist-one'})).ids[0],source.id);assert.deepEqual(await service.studio.audio(attached.id),audio(3));
  await service.close();service=await open(root);assert.equal((await call(service,'studio_attach_sound',request)).id,attached.id);await call(service,'studio_update_project',{projectId:'office',deleted:true});await assert.rejects(()=>call(service,'studio_attach_sound',request));await call(service,'studio_update_project',{projectId:'office',deleted:false});await call(service,'studio_update_version',{versionId:attached.id,deleted:true});library=await call(service,'sound_library_page',{});assert.equal(library.items[0].id,source.id);assert.deepEqual(await service.soundLibrary.audio(source.id),audio(3));
  await call(service,'studio_purge',{kind:'version',id:attached.id});assert.deepEqual(await service.soundLibrary.audio(source.id),audio(3));assert.equal((await call(service,'sound_library_queue',{playlistId:'playlist-one'})).ids[0],source.id);
  await assert.rejects(()=>call(service,'studio_attach_sound',{...request,title:'不同名称'}));
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('an attached FLAC remains FLAC when played or downloaded and can be trimmed to a WAV child',async()=>{
 const {serveHttp}=await import('../../server/http.ts');const root=await mkdtemp(join(tmpdir(),'attach-flac-')),service=await open(root),assets={read:async()=>new Uint8Array(),has:()=>false,embedded:false};let http:Awaited<ReturnType<typeof serveHttp>>|undefined;
 try{
  const flac=await readFile(new URL('./fixtures/tone-440hz.flac',import.meta.url)),item=await service.soundLibrary.import({name:'tone.flac',title:'提示声',requestId:'attach-flac-source',bytes:flac});await call(service,'create_project',{projectId:'office',title:'办公室'});
  const version=await call(service,'studio_attach_sound',{itemId:item.id,projectId:'office',title:'提示声',requestId:'attach-flac'});http=await serveHttp(service,assets);const response=await fetch(http.runtime.url+version.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});
  assert.equal(response.headers.get('content-type'),'audio/flac');assert.deepEqual(Buffer.from(await response.arrayBuffer()),flac);assert.equal((await call(service,'sound_library_page',{filter:'effects'})).items[0].item.extension,'flac');
  const clipped=await call(service,'studio_trim_audio',{versionId:version.id,startSeconds:0,endSeconds:1,requestId:'trim-flac'}),wavResponse=await fetch(http.runtime.url+clipped.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});assert.equal(wavResponse.headers.get('content-type'),'audio/wav');const decoded=await decodeAudio(new Uint8Array(await wavResponse.arrayBuffer()));assert.equal(decoded.channelData[0].length,decoded.sampleRate);
 }finally{await http?.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('active project effects block deletion and cancellation stops their own task',async()=>{
 const root=await mkdtemp(join(tmpdir(),'effect-project-cancel-'));let entered=false,stopped=false;
 const blocking:EffectDriver={...driver,generate:async(_req,execution)=>new Promise((_resolve,reject)=>{entered=true;execution.signal.addEventListener('abort',()=>{stopped=true;reject(execution.signal.reason);},{once:true});})};
 const service=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,undefined,undefined,testResources(),undefined,blocking);
 try{
  await call(service,'create_project',{projectId:'office',title:'办公室'});const sound=await call(service,'studio_create_sound',{projectId:'office',title:'咕噜',kind:'effect'});
  const job=await call(service,'sound_effect_generate',{requestId:'effect-blocking',title:'咕噜',prompt:'bubbles',seconds:3,soundId:sound.id});for(let i=0;i<200&&!entered;i++)await new Promise(r=>setTimeout(r,5));assert.equal(entered,true);
  await assert.rejects(()=>call(service,'studio_update_sound',{soundId:sound.id,deleted:true}),/取消|等待/);await assert.rejects(()=>call(service,'studio_update_project',{projectId:'office',deleted:true}),/取消|等待/);
  const cancelled=await call(service,'studio_cancel',{versionId:job.id});assert.equal(stopped,true);assert.equal(cancelled.state,'cancelled');assert.equal((await call(service,'sound_library_page',{filter:'effects'})).total,0);
  await call(service,'studio_update_sound',{soundId:sound.id,deleted:true});assert.equal((await call(service,'studio_library',{})).sounds.find((s:any)=>s.id===sound.id).deleted,true);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
