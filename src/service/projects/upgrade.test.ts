import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
import {hash} from './store.ts';
const fixture=new URL('../../../tests/fixtures/workspace-2026-10-10/',import.meta.url);
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('pinned historical workspace upgrades twice and restores from an immutable backup without losing decisions or audio',async()=>{
 const root=await mkdtemp(join(tmpdir(),'upgrade-')),provenance=JSON.parse(await readFile(new URL('provenance.json',fixture),'utf8'));
 const active=join(root,'active'),backup=join(root,'backup'),restored=join(root,'restored');
 for(const [path,expected] of Object.entries(provenance.sha256))assert.equal(hash(await readFile(new URL('workspace/'+path,fixture))),expected,`historical fixture changed: ${path}`);
 await cp(new URL('workspace',fixture),active,{recursive:true});await cp(active,backup,{recursive:true});
 const open=(path:string)=>MusicService.open(path,()=>{throw Error('unused');},async()=>new Uint8Array(),false,unused,undefined,undefined,testResources());
 const ids=provenance.identities;let service=await open(active);
 const verify=async()=>{
  const snapshot=await service.studio.snapshot();assert.equal(snapshot.sounds.length,2);assert.equal(snapshot.versions.length,3);
  assert.equal(snapshot.sounds.find(s=>s.id===ids.clipId)?.finalVersionId,ids.scoreId);
  assert.equal(snapshot.sounds.find(s=>s.id===ids.speechSoundId)?.finalVersionId,ids.firstId);
  const deleted=snapshot.versions.find(v=>v.id===ids.deletedId)!;assert.equal(deleted.parentId,ids.firstId);assert.equal(deleted.deleted,true);
  assert.equal(snapshot.versions.find(v=>v.id===ids.firstId)?.state,'succeeded');
  assert.equal(hash(service.speech.audio(ids.firstId)),provenance.sha256[`speech/audio/${ids.firstId}.wav`]);
  assert.equal((await service.store.feedback('historical'))[0].text,'保留这一句旋律');
  assert.equal((await service.store.project('historical-trash')).deleted,true);
  await service.store.revision('historical',ids.scoreId);
  return snapshot.versions.map(v=>({id:v.id,number:v.number,parentId:v.parentId,deleted:v.deleted,kept:v.kept,soundId:v.soundId}));
 };
 try{
  const first=await verify();await service.close();service=await open(active);assert.deepEqual(await verify(),first);
  await service.studio.update({versionId:ids.deletedId,deleted:false});assert.equal((await service.studio.snapshot()).versions.find(v=>v.id===ids.deletedId)?.deleted,false);
  // Backup is the entire stopped workspace, not just the two index files.
  for(const [path,expected] of Object.entries(provenance.sha256))assert.equal(hash(await readFile(join(backup,path))),expected);
  await service.close();await cp(backup,restored,{recursive:true});service=await open(restored);assert.deepEqual(await verify(),first);
  for(const [path,expected] of Object.entries(provenance.sha256))if(path.endsWith('.wav')||path.endsWith('/score.json'))assert.equal(hash(await readFile(join(active,path))),expected);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
