import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
import {encodeWav} from '../../wav.ts';
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const renderer=(snapshot:any)=>({result:Promise.resolve({wav:new Uint8Array(encodeWav([new Float32Array(Math.round(snapshot.composition.score.duration*44100)),new Float32Array(Math.round(snapshot.composition.score.duration*44100))],44100)),peak:0,rms:0,attenuation:1,engine:'test'}),cancel:()=>{}});
const phases=['library-before-index','library-after-index','score-before-manifest','score-after-manifest','mix-after-manifest','purge-after-intent'];
for(const phase of phases)test(`SIGKILL recovery: ${phase}`,{timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'publication-crash-'));
 const open=()=>MusicService.open(root,renderer,async()=>new Uint8Array(),false,unused,undefined,undefined,testResources());let service=await open();
 try{
  await service.store.createProject('crash','崩溃恢复');
  const sound=await service.studio.createSound({projectId:'crash',title:'必须保持所属声音',kind:'clip'});
  const source=await service.studio.importScore({soundId:sound.id,compositionJson:await readFile('src/music/authoring/example.json','utf8')});
  await service.studio.update({versionId:source.id,final:true,kept:true});
  const original=await service.store.revision('crash',source.id);
  if(phase.startsWith('purge-'))await service.studio.update({versionId:source.id,deleted:true});
  await service.close();
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/publication-crash.ts',import.meta.url)),root,phase,sound.id,source.id],{stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
  assert.equal(await readFile(join(root,'fault-reached'),'utf8'),phase,log);assert.equal(exit.signal,'SIGKILL',log);
  service=await open();const snapshot=await service.studio.snapshot();
  if(phase.startsWith('library-')){
   assert.equal(snapshot.soundLibrary.length,phase==='library-after-index'?1:0);
   const bytes=new Uint8Array(encodeWav([new Float32Array(8000)],8000));
   const item=await service.soundLibrary.import({name:'tone.wav',requestId:'crash-import',bytes});
   assert.equal(service.soundLibrary.list().length,1);assert.deepEqual(await service.soundLibrary.audio(item.id),Buffer.from(bytes));
   assert.equal((await readdir(join(root,'sound-library'))).filter(x=>x.endsWith('.wav')).length,1,'uncommitted owned audio is reclaimed');
  }else if(phase==='purge-after-intent'){
   const v=snapshot.versions.find(v=>v.id===source.id)!;assert.ok(v.purgePending);assert.equal(v.audioPath,undefined);
   await assert.rejects(service.studio.update({versionId:v.id,deleted:false}),/删除尚未完成/);
   await service.studio.purge({kind:'version',id:v.id});assert.equal((await service.studio.snapshot()).versions.length,0);
   await service.close();service=await open();assert.equal((await service.studio.snapshot()).versions.length,0);
   await assert.rejects(service.store.revision('crash',source.id),/不存在/);return;
  }else{
   const published=phase!=='score-before-manifest';
   assert.equal(snapshot.sounds.length,1,'publication must not invent a legacy sound');
   assert.equal(snapshot.versions.length,published?2:1);
   assert.ok(snapshot.versions.every(v=>v.soundId===sound.id));
   assert.equal((await readdir(join(root,'projects/crash/revisions'))).length,published?2:1,'unpublished score files are reclaimed');
   if(phase==='mix-after-manifest'){
    const child=snapshot.versions.find(v=>v.id!==source.id)!;
    assert.equal(child.mixRequestId,'crash-mix');assert.equal(child.parentId,source.id);assert.equal(child.scoreMix?.volume,.5);
    const retry=await service.studio.saveMix({versionId:source.id,requestId:'crash-mix',mix:{volume:.5}});
    assert.equal(retry.id,child.id);assert.equal((await service.studio.snapshot()).versions.length,2);
   }
  }
  assert.equal((await service.studio.snapshot()).sounds[0].finalVersionId,source.id);
  assert.deepEqual(await service.store.revision('crash',source.id),original);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
