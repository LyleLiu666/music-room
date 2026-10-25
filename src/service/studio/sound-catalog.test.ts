import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {SoundCatalog} from './sound-catalog.ts';
import type {LibrarySound} from './sound-library.ts';
const items=(count:number):LibrarySound[]=>Array.from({length:count},(_,i)=>({id:`version-${i}`,title:`声音 ${i}`,createdAt:new Date(1700000000000+i*1000).toISOString(),origin:'generated',projectId:'film',projectTitle:i%2?'电影':'旁白',soundId:'sound',versionId:`version-${i}`,number:i+1,final:i%2===0,kept:true,extension:'wav',audioPath:`/studio-audio/version-${i}`,duration:2}));
test('10000 sounds are filtered and stably paged on the server; playback order covers every page',async()=>{
 const root=await mkdtemp(join(tmpdir(),'catalog-')),store=await ProjectStore.open(root);let source=items(10000);
 try{
  const catalog=new SoundCatalog(store,async()=>source);
  const page=await catalog.page({page:2,pageSize:20});assert.equal(page.items.length,20);assert.equal(page.total,10000);assert.equal(page.items[0].id,'version-9979');assert.equal(page.page,2);
  const filtered=await catalog.page({query:'电影',filter:'final'});assert.equal(filtered.total,0);
  const all=await catalog.queue({query:'电影'});assert.equal(all.ids.length,5000);assert.equal(all.ids[0],'version-9999');assert.ok(!('audioPath' in all),'queue creation transfers IDs, not every sound record');
  const revision=page.revision;source=[...source,{...source[0],id:'added',createdAt:'2099-01-01'}];assert.notEqual((await catalog.page({})).revision,revision);
  assert.equal((await catalog.page({page:99999,pageSize:50})).items.length,1);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('playlists keep exact versions and order across restart, retain unavailable names, and reject stale edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'playlists-'));let store=await ProjectStore.open(root),source=items(3);
 try{
  let catalog=new SoundCatalog(store,async()=>source);
  let saved=await catalog.save({id:'playlist-test',title:'写代码',ids:['version-1','version-0','version-1'],revision:0});assert.equal(saved.revision,1);assert.equal(saved.count,2);assert.equal((await catalog.save({id:'playlist-test',title:'写代码',ids:['version-1','version-0'],revision:0})).revision,1,'a lost successful response can be recovered without creating another list');
  await assert.rejects(catalog.save({id:saved.id,title:'过期覆盖',ids:[],revision:0}),/已改变/);
  const before=await catalog.queue({playlistId:saved.id});assert.deepEqual(before.ids,['version-1','version-0']);
  source=source.filter(i=>i.id!=='version-1');const unavailable=await catalog.page({playlistId:saved.id});assert.equal(unavailable.items[0].title,'声音 1');assert.equal(unavailable.items[0].item,null);
  saved=await catalog.save({id:saved.id,title:'新名称',ids:['version-0','version-1'],revision:saved.revision});
  await store.close();store=await ProjectStore.open(root);catalog=new SoundCatalog(store,async()=>source);
  assert.equal(catalog.playlists()[0].title,'新名称');assert.deepEqual((await catalog.queue({playlistId:saved.id})).ids,['version-0','version-1']);
  await assert.rejects(catalog.remove({id:saved.id,revision:1}),/已改变/);await catalog.remove({id:saved.id,revision:2});assert.equal(catalog.playlists().length,0);assert.equal(source.length,2,'deleting a playlist does not delete audio');
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('workbench polling omits 10000 library records and heavy version inputs; list endpoints remain bounded',async()=>{
 const {MusicService}=await import('../service.ts'),{testResources}=await import('../resources/testing.ts');
 const root=await mkdtemp(join(tmpdir(),'catalog-polling-')),store=await ProjectStore.open(root);await store.createProject('film','性能验证');
 const sounds=[{id:'sound',projectId:'film',title:'音乐',kind:'music',createdAt:'2026-10-24'}],versions=items(10000).map((i,n)=>({id:i.id,soundId:'sound',number:n+1,createdAt:i.createdAt,state:'succeeded',stage:'完成',kept:true,deleted:false,source:{kind:'music',id:`job-${n}`},audioPath:i.audioPath,input:{soundId:'sound',text:'较长的创作要求'.repeat(200)}}));
 store.atomicJSON(store.path('studio.json'),{format:'music-room-studio',version:1,sounds,versions});await store.close();
 const service=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,undefined,undefined,undefined,testResources());
 try{
  const snapshot=await service.call('studio_library',{includeSoundLibrary:false,compactLibrary:true,selectedVersionId:'version-0'});assert.equal(snapshot.soundLibrary.length,0);assert.equal(snapshot.versions.length,1);assert.equal(snapshot.taskHistory.length,0);assert.ok(snapshot.soundLibraryRevision);
  const page=await service.call('sound_library_page',{pageSize:20});assert.equal(page.items.length,20);assert.equal(page.total,10000);assert.equal(page.revision,snapshot.soundLibraryRevision);
  const saved=await service.call('sound_playlist_save',{id:'playlist-versions',title:'固定版本',ids:['version-0','version-1'],revision:0});
  await service.call('studio_update_version',{versionId:'version-0',kept:false});assert.ok((await service.call('sound_library_items',{ids:['version-0']})).items[0].item,'unmarking collection does not replace or remove a saved exact version');
  await service.call('studio_update_version',{versionId:'version-0',deleted:true});const unavailable=await service.call('sound_library_page',{playlistId:saved.id});assert.equal(unavailable.items[0].item,null);assert.equal(unavailable.items[0].title,'音乐');
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
