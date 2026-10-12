import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {SoundLibrary,collectedSounds} from './sound-library.ts';
import {encodeWav} from '../../wav.ts';
import type {StudioSound,StudioVersion} from './studio.ts';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
const wav=Buffer.from(encodeWav([new Float32Array(22050)],22050));
test('collection follows final and inspiration decisions across projects without duplicates or deleted audio',()=>{
 const projects=[{id:'one',title:'一个项目'},{id:'two',title:'另一个项目'},{id:'trash',title:'回收站项目',deleted:true}];
 const sounds:StudioSound[]=[{id:'s1',projectId:'one',title:'主题曲',kind:'music',createdAt:'',finalVersionId:'v1'},{id:'s2',projectId:'two',title:'旁白',kind:'speech',createdAt:''},{id:'s3',projectId:'trash',title:'已删除',kind:'music',createdAt:''},{id:'s4',projectId:'one',title:'片段已删除',kind:'music',createdAt:'',deleted:true}];
 const v=(id:string,soundId:string,patch:Partial<StudioVersion>={}):StudioVersion=>({id,soundId,number:1,createdAt:'2026-10-11',state:'succeeded',stage:'完成',kept:true,deleted:false,source:{kind:'music',id},audioPath:`/yue2-audio/${id}`,...patch});
 const versions=[v('v1','s1'),v('v2','s2'),v('ordinary','s2',{kept:false}),v('failed','s2',{state:'failed'}),v('missing','s2',{audioPath:undefined}),v('deleted','s2',{deleted:true}),v('purge','s2',{purgePending:true}),v('project-trash','s3'),v('sound-trash','s4')];
 const list=collectedSounds(projects,sounds,versions);assert.deepEqual(list.map(x=>x.id).sort(),['v1','v2']);assert.equal(list[0].final,true);assert.equal(list[0].kept,true);assert.equal(list[1].projectTitle,'另一个项目');
 sounds[0].finalVersionId=undefined;versions[0].kept=false;assert.deepEqual(collectedSounds(projects,sounds,versions).map(x=>x.id),['v2']);
});
test('external import preserves bytes across restart; retries are safe and invalid uploads leave no records',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-library-'));let store=await ProjectStore.open(root);
 try{
  let lib=new SoundLibrary(store);const first=await lib.import({name:'原始 声音.wav',title:'测试声音',requestId:'first',bytes:wav});
  assert.equal(first.duration,1);assert.equal(first.origin,'imported');assert.deepEqual(await lib.audio(first.id),wav);
  assert.equal((await lib.import({name:'原始 声音.wav',title:'测试声音',requestId:'first',bytes:wav})).id,first.id);
  await assert.rejects(lib.import({name:'different.wav',title:'测试声音',requestId:'first',bytes:wav}),/重复请求/);
  await assert.rejects(lib.import({name:'bad.wav',requestId:'bad',bytes:Buffer.from('not audio')}),/音频/);
  await assert.rejects(lib.import({name:'truncated.wav',requestId:'truncated',bytes:wav.subarray(0,100)}),/WAV/);
  await assert.rejects(lib.import({name:'../outside.wav',requestId:'unsafe',bytes:wav}),/文件名/);
  const controller=new AbortController();controller.abort();await assert.rejects(lib.import({name:'cancel.wav',requestId:'cancelled',bytes:wav},controller.signal));assert.equal(lib.list().length,1);
  await store.close();store=await ProjectStore.open(root);lib=new SoundLibrary(store);assert.equal(lib.list()[0].title,'测试声音');assert.deepEqual(await lib.audio(first.id),wav);
  await writeFile(join(root,'sound-library',first.id+'.wav'),Buffer.from(wav).fill(0));await assert.rejects(lib.audio(first.id),/完整|修改/);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('import refuses a linked storage directory instead of writing outside the workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-library-link-')),outside=await mkdtemp(join(tmpdir(),'sound-outside-')),store=await ProjectStore.open(root);
 try{await symlink(outside,join(root,'sound-library'));assert.throws(()=>new SoundLibrary(store),/符号链接/);}finally{await store.close();await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('FLAC imports retain encoded bytes and reject incomplete frames',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-library-flac-')),store=await ProjectStore.open(root);
 try{const lib=new SoundLibrary(store),flac=await readFile(new URL('./fixtures/tone-440hz.flac',import.meta.url)),item=await lib.import({name:'音乐.flac',requestId:'flac',bytes:flac});assert.equal(item.extension,'flac');assert.ok(item.duration>0);assert.deepEqual(await lib.audio(item.id),flac);await assert.rejects(lib.import({name:'缺尾.flac',requestId:'short',bytes:flac.subarray(0,42)}),/FLAC.*不完整/);assert.equal(lib.list().length,1);}finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('global collection includes conversion versions outside the current page and follows owner changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-library-pages-')),store=await ProjectStore.open(root);
 await store.createProject('film','影片');const sound:StudioSound={id:'conversion-sound',projectId:'film',title:'完成的转换',kind:'conversion',createdAt:'2026-10-11',finalVersionId:'version-12'};
 const versions:StudioVersion[]=Array.from({length:12},(_,i)=>({id:`version-${i+1}`,soundId:sound.id,number:i+1,createdAt:`2026-10-11T00:00:${String(i).padStart(2,'0')}Z`,state:'succeeded',stage:'完成',kept:i===0,deleted:false,source:{kind:'conversion',id:`job-${i+1}`},audioPath:`/conversion/audio/job-${i+1}/converted`}));
 store.atomicJSON(store.path('studio.json'),{format:'music-room-studio',version:1,sounds:[sound],versions});await store.close();
 const svc=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,undefined,undefined,undefined,testResources());
 try{const snapshot=await svc.call('studio_library',{paginateConversions:true,conversionSoundId:sound.id,conversionPageSize:2});assert.equal(snapshot.versions.length,2);assert.deepEqual(snapshot.soundLibrary.map(x=>x.id).sort(),['version-1','version-12']);await svc.call('studio_update_version',{versionId:'version-12',final:false});assert.deepEqual((await svc.call('studio_library',{})).soundLibrary.map(x=>x.id),['version-1']);await svc.call('studio_update_project',{projectId:'film',deleted:true});assert.equal((await svc.call('studio_library',{})).soundLibrary.length,0);await svc.call('studio_update_project',{projectId:'film',deleted:false,title:'恢复的影片'});const restored=(await svc.call('studio_library',{})).soundLibrary[0];assert.equal(restored.origin,'generated');if(restored.origin==='generated')assert.equal(restored.projectTitle,'恢复的影片');}finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
