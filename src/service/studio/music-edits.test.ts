import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const fixture=await readFile('src/trials/yue2/fixture.abc','utf8');
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'music-edits-')),requests:any[]=[],jobs:any[]=[];let score=fixture;
 const open=async()=>{const service=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,undefined,undefined,testResources());
  service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
  service.yue2Client.list=async()=>({jobs});service.yue2Client.score=async()=>score;
  service.yue2Client.generate=async args=>{requests.push(structuredClone(args));const job:any={id:crypto.randomUUID().replaceAll('-',''),status:'done',kind:'create',title:args.title};jobs.push(job);return {job};};return service;};
 let service=await open();await service.call('create_project',{projectId:'edit',title:'改谱'});
 const sound=await service.call('studio_create_sound',{projectId:'edit',title:'歌曲',kind:'music'});
 const source=await service.call('studio_generate',{soundId:sound.id,text:'钢琴伴奏',instrumental:false,lyrics:'[verse]\n春天来了\n[outro]',seed:42,targetDuration:180});
 await service.call('studio_update_version',{versionId:source.id,final:true});
 return {get service(){return service;},requests,sound,source,setScore:(s:string)=>score=s,reopen:async()=>{await service.close();service=await open();},close:async()=>{await service.close();await rm(root,{recursive:true,force:true});}};
}
test('instrumental edit persists a draft and generates one child through the normal queue with correct input',async()=>{
 const f=await setup();try{
  const draft=await f.service.call('studio_music_edit_open',{versionId:f.source.id,kind:'transfer'});
  const ready=await f.service.call('studio_music_edit_prepare',{draftId:draft.id,revision:draft.revision,style:'纯器乐，钢琴演奏主旋律',change:{kind:'transfer',overlap:'error'}});
  assert.equal(ready.candidate!.summary.voices.Vocal.sounding_notes,0);assert.equal(f.requests.length,1);
  assert.equal((await f.service.call('studio_library',{})).versions.length,1);
  await f.reopen();assert.deepEqual(await f.service.call('studio_music_edit_open',{versionId:f.source.id,kind:'transfer'}),ready);
  const args={draftId:ready.id,revision:ready.revision};
  const [child,retry]=await Promise.all([f.service.call('studio_music_edit_generate',args),f.service.call('studio_music_edit_generate',args)]);
  assert.equal(child.id,retry.id);assert.equal(child.parentId,f.source.id);assert.equal(child.soundId,f.sound.id);assert.equal(child.number,2);
  assert.equal(child.musicEdit!.label,'器乐演奏版');assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].instrumental,true);assert.equal(f.requests[1].seed,42);assert.equal(f.requests[1].abc,ready.candidate!.abc);
  assert.doesNotMatch(f.requests[1].lyrics,/春天/);assert.match(f.requests[1].lyrics,/\[verse\]/);
  const library=await f.service.call('studio_library',{});assert.equal(library.sounds[0].finalVersionId,f.source.id);assert.deepEqual(library.versions[0].input,f.source.input);
  await f.reopen();assert.equal((await f.service.call('studio_music_edit_generate',args)).id,child.id);assert.equal(f.requests.length,2);
 }finally{await f.close();}
});
test('harmony accepts any AI text but rejects melody changes; stale drafts and changed sources cannot generate',async()=>{
 const f=await setup();try{
  const draft=await f.service.call('studio_music_edit_open',{versionId:f.source.id,kind:'harmony'});
  const brief=await f.service.call('studio_music_edit_brief',{draftId:draft.id,instruction:'保持旋律，让和声更明亮'});
  assert.match(brief.text,/AI|LLM/);assert.doesNotMatch(brief.text,/Codex/);assert.ok(brief.text.includes(fixture));
  const args={draftId:draft.id,revision:0,style:'钢琴伴奏',change:{kind:'harmony' as const,abc:fixture.replace('C32','D32')}};
  await assert.rejects(f.service.call('studio_music_edit_prepare',args),/保留约束/);
  const ready=await f.service.call('studio_music_edit_prepare',{...args,change:{kind:'harmony',abc:fixture.replace('"C"','"Am"')}});
  await assert.rejects(f.service.call('studio_music_edit_prepare',args),/草稿.*更新/);
  await assert.rejects(f.service.call('studio_music_edit_generate',{draftId:ready.id,revision:0}),/草稿.*更新/);
  f.setScore(fixture.replace('C32','D32'));await assert.rejects(f.service.call('studio_music_edit_generate',{draftId:ready.id,revision:ready.revision}),/原谱.*变化/);
  f.setScore(fixture);await f.service.call('studio_update_version',{versionId:f.source.id,deleted:true});
  await assert.rejects(f.service.call('studio_music_edit_generate',{draftId:ready.id,revision:ready.revision}),/回收站/);
  assert.equal(f.requests.length,1);
 }finally{await f.close();}
});
test('tempo and explicit section edits preserve mode and align lyrics; unavailable scores fail clearly',async()=>{
 const f=await setup();try{
  const d=await f.service.call('studio_music_edit_open',{versionId:f.source.id,kind:'tempo'});
  const r=await f.service.call('studio_music_edit_prepare',{draftId:d.id,revision:0,style:'钢琴伴奏',change:{kind:'tempo',bpm:110}});
  assert.equal(r.candidate!.summary.bpm,110);const child=await f.service.call('studio_music_edit_generate',{draftId:r.id,revision:r.revision});
  assert.equal(child.input!.instrumental,false);assert.equal(child.input!.lyrics,f.source.input!.lyrics);
  assert.equal(f.source.input!.targetDuration,180);assert.equal(child.input!.targetDuration,undefined,'explicit tempo/section edits define their own length');
  const s=await f.service.call('studio_music_edit_open',{versionId:f.source.id,kind:'section'});
  const repeated=await f.service.call('studio_music_edit_prepare',{draftId:s.id,revision:0,style:'钢琴伴奏',change:{kind:'section',index:0,action:'repeat'}});
  assert.equal(repeated.candidate!.summary.sections.length,3);assert.equal(repeated.candidate!.input.lyrics!.split('春天').length,3);
  f.service.yue2Client.score=async()=>{throw Error('此版本没有保存 ABC 乐谱');};
  await assert.rejects(f.service.call('studio_music_edit_open',{versionId:child.id,kind:'harmony'}),/没有保存 ABC/);
 }finally{await f.close();}
});
test('failed submission is retry safe; a new checked revision can retry, and purge removes source drafts',async()=>{
 const f=await setup();try{
  const draft=await f.service.call('studio_music_edit_open',{versionId:f.source.id,kind:'tempo'});
  const args={draftId:draft.id,revision:0,style:'钢琴',change:{kind:'tempo' as const,bpm:100}};
  const ready=await f.service.call('studio_music_edit_prepare',args);let calls=0;
  f.service.yue2Client.generate=async()=>{calls++;throw Error('模型容量不足');};
  const request={draftId:ready.id,revision:ready.revision},failed=await f.service.call('studio_music_edit_generate',request);
  assert.equal(failed.state,'failed');assert.equal((await f.service.call('studio_music_edit_generate',request)).id,failed.id);assert.equal(calls,1);
  const next=await f.service.call('studio_music_edit_prepare',{...args,revision:ready.revision});
  assert.notEqual((await f.service.call('studio_music_edit_generate',{draftId:next.id,revision:next.revision})).id,failed.id);assert.equal(calls,2);
  await f.service.call('studio_update_version',{versionId:f.source.id,deleted:true});f.service.yue2Client.purgeAudio=async()=>{};
  await f.service.call('studio_purge',{kind:'version',id:f.source.id});assert.equal(existsSync(f.service.store.path('music-edits',draft.id+'.json')),false);
 }finally{await f.close();}
});
