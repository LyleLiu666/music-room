import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
import {encodeWav} from '../../wav.ts';
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('mixing creates a durable child in the same sound without changing the original or final choice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-mix-'));const snapshots:any[]=[];
 const renderer=(snapshot:any)=>{snapshots.push(snapshot);return {result:Promise.resolve({wav:new Uint8Array(encodeWav([new Float32Array(Math.round(snapshot.composition.score.duration*44100)),new Float32Array(Math.round(snapshot.composition.score.duration*44100))],44100)),peak:0,rms:0,attenuation:1,engine:'test'}),cancel:()=>{}};};
 const open=()=>MusicService.open(root,renderer,async()=>new Uint8Array(),false,unused,undefined,undefined,testResources());let service=await open();
 try{
  await service.call('create_project',{projectId:'mix',title:'混音项目'});
  const sound=await service.call('studio_create_sound',{projectId:'mix',title:'开场',kind:'clip'});
  const source=await service.call('studio_import_score',{soundId:sound.id,compositionJson:await readFile('src/music/authoring/example.json','utf8')});
  await service.call('studio_update_version',{versionId:source.id,final:true});
  const original=await service.call('get_revision',{projectId:'mix',revisionId:source.source.id});
  await service.call('studio_update_project',{projectId:'mix',title:'改名后的混音项目'});
  const args={versionId:source.id,requestId:'mix-first',mix:{lead:'flute' as const,volume:.5,muted:['bass' as const],solo:[],levels:{melody:.6}}};
  const child=await service.call('studio_save_mix',args);
  assert.equal(child.parentId,source.id);assert.equal(child.soundId,sound.id);assert.equal(child.number,2);
  assert.notEqual(child.source.id,source.source.id);
  assert.equal((await service.call('studio_save_mix',args)).id,child.id);
  await assert.rejects(service.call('studio_save_mix',{...args,mix:{volume:.8}}),/请求/);
  await assert.rejects(service.call('studio_save_mix',{...args,requestId:'bad',mix:{volume:3}}),/混音/);
  for(let i=0;i<100;i++){const library=await service.call('studio_library',{});if(library.versions.find(v=>v.id===child.id)?.audioPath)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].mix.lead,'flute');assert.equal(snapshots[0].mix.volume,.5);
  assert.deepEqual(await service.call('get_revision',{projectId:'mix',revisionId:source.source.id}),original);
  await service.close();service=await open();
  const library=await service.call('studio_library',{}),saved=library.versions.find(v=>v.id===child.id)!;
  assert.ok(saved.audioPath);assert.equal(saved.scoreMix?.lead,'flute');assert.equal(library.sounds[0].finalVersionId,source.id);assert.equal(library.versions.length,2);
  await service.call('studio_update_version',{versionId:source.id,deleted:true});
  await assert.rejects(service.call('studio_save_mix',{...args,requestId:'deleted'}),/删除|回收站/);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
