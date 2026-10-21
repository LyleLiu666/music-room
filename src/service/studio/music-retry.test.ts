import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MusicService} from '../service.ts';
import {testResources} from '../resources/testing.ts';

async function fixture(t:any){
 const root=await mkdtemp(join(tmpdir(),'music-retry-')),jobs:any[]=[],submitted:any[]=[],purged:string[]=[];
 const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 let svc:MusicService;
 const open=async()=>{svc=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,undefined,undefined,testResources());svc.yue2.status=async()=>({canGenerate:true,directory:'/installed'} as any);svc.yue2Client.list=async()=>({jobs});svc.yue2Client.generate=async(input,resumeFrom)=>{submitted.push({input,resumeFrom});const job={id:submitted.length.toString(16).padStart(32,'0'),status:'failed',kind:'create',error:'interrupted'};jobs.push(job);return {job} as any;};svc.yue2Client.purgeAudio=async id=>{purged.push(id);return {} as any;};};
 await open();t.after(async()=>{await svc.close();await rm(root,{recursive:true,force:true});});
 await svc!.call('create_project',{projectId:'retry',title:'恢复'});const sound=await svc!.call('studio_create_sound',{projectId:'retry',title:'音乐',kind:'music'});
 return {get svc(){return svc;},jobs,submitted,purged,sound,reopen:async()=>{await svc.close();await open();}};
}

test('resume stays in the original version, survives polling/restart and retains the best saved stage',async t=>{
 const f=await fixture(t),original=await f.svc.call('studio_generate',{soundId:f.sound.id,text:'piano',instrumental:true,seed:42,targetDuration:180});
 const recovery={jobId:original.source.id,stage:'synthesis'};f.jobs[0].recovery=recovery;
 const a=await f.svc.call('studio_retry_music',{versionId:original.id,requestId:'attempt-2',expectedJobId:original.source.id});
 assert.equal(a.id,original.id);assert.equal(a.number,1);assert.equal(a.parentId,undefined);assert.equal(a.createdAt,original.createdAt);
 assert.equal(a.musicAttempts?.length,1);assert.equal(a.musicAttempts?.[0].error,'interrupted');assert.equal(f.submitted[1].resumeFrom,original.source.id);assert.deepEqual(f.submitted[1].input,f.submitted[0].input);
 await f.reopen();
 await f.svc.call('studio_retry_music',{versionId:original.id,requestId:'attempt-2',expectedJobId:original.source.id});assert.equal(f.submitted.length,2,'duplicate request after immediate failure/restart');
 await f.svc.call('studio_retry_music',{versionId:original.id,requestId:'stale-tab',expectedJobId:original.source.id});assert.equal(f.submitted.length,2,'stale tab must not enqueue another attempt');
 const b=await f.svc.call('studio_retry_music',{versionId:original.id,requestId:'attempt-3',expectedJobId:a.source.id});
 assert.equal(b.id,original.id);assert.equal(b.musicAttempts?.length,2);assert.equal(f.submitted[2].resumeFrom,original.source.id);
 f.jobs[2].status='done';await f.reopen();
 const library=await f.svc.call('studio_library',{});assert.equal(library.versions.length,1);assert.equal(library.sounds.length,1);assert.equal(library.taskHistory.length,1);
 const saved=library.versions[0];assert.equal(saved.state,'succeeded');assert.equal(saved.audioPath,`/yue2-audio/${f.jobs[2].id}`);assert.equal(saved.musicAttempts?.length,2);
 await assert.rejects(f.svc.call('studio_retry_music',{versionId:original.id}),/失败|取消/);
 const creative=await f.svc.call('studio_generate',{...original.input!,parentId:original.id,text:'different piano'});assert.notEqual(creative.id,original.id);assert.equal(creative.number,2);
});

test('fresh attempts keep the version and rotate seeds without losing history, including wraparound',async t=>{
 const f=await fixture(t);
 for(const seed of [42,2147483647]){
  const original=await f.svc.call('studio_generate',{soundId:f.sound.id,text:'flute',instrumental:seed===42,lyrics:'[Verse]\n歌词',targetDuration:180,seed});
  const first=f.submitted.at(-1).input;
  for(let i=1;i<=3;i++){
   const v=await f.svc.call('studio_retry_music',{versionId:original.id,requestId:`${seed}-${i}`});assert.equal(v.id,original.id);assert.equal(v.input?.seed,(seed+i*3)%2147483648);assert.equal(v.musicAttempts?.length,i);assert.deepEqual(f.submitted.at(-1),{input:{...first,seed:v.input?.seed},resumeFrom:undefined});
   await f.reopen();
  }
 }
 assert.equal((await f.svc.call('studio_library',{})).versions.length,2);
});

test('concurrent retries queue once and trash/purge retain old job ownership',async t=>{
 const f=await fixture(t),v=await f.svc.call('studio_generate',{soundId:f.sound.id,text:'piano',seed:42});
 const generate=f.svc.yue2Client.generate;f.svc.yue2Client.generate=async(...args)=>{const result=await generate(...args);result.job.status='queued';return result;};
 await Promise.all([f.svc.call('studio_retry_music',{versionId:v.id,requestId:'a',expectedJobId:v.source.id}),f.svc.call('studio_retry_music',{versionId:v.id,requestId:'b',expectedJobId:v.source.id})]);assert.equal(f.submitted.length,2);
 f.jobs[1].status='failed';await f.reopen();await f.svc.call('studio_update_version',{versionId:v.id,deleted:true});
 await assert.rejects(f.svc.call('studio_retry_music',{versionId:v.id}),/删除|回收站/);
 await f.svc.call('studio_purge',{kind:'version',id:v.id});assert.deepEqual(new Set(f.purged),new Set(f.jobs.map(j=>j.id)));
 await f.reopen();const library=await f.svc.call('studio_library',{});assert.equal(library.versions.length,0);assert.equal(library.sounds.length,1,'old engine jobs cannot be reimported as new sounds');
});

test('submission errors retain the recovery point and archived attempt',async t=>{
 const f=await fixture(t),v=await f.svc.call('studio_generate',{soundId:f.sound.id,text:'piano',seed:42});f.jobs[0].recovery={jobId:v.source.id,stage:'plan'};
 f.svc.yue2Client.generate=async()=>{throw Error('service unavailable');};
 const failed=await f.svc.call('studio_retry_music',{versionId:v.id,requestId:'unavailable'});assert.equal(failed.id,v.id);assert.equal(failed.state,'failed');assert.match(failed.error!,/service unavailable/);
 await f.reopen();const saved=(await f.svc.call('studio_library',{})).versions[0];assert.equal(saved.musicRecovery?.jobId,v.source.id);
 const resumed=await f.svc.call('studio_retry_music',{versionId:v.id,requestId:'available'});assert.equal(resumed.id,v.id);assert.equal(f.submitted.at(-1).resumeFrom,v.source.id);assert.equal(resumed.musicAttempts?.length,2);
});

test('legacy child versions can still resume their parent without changing either version number',async t=>{
 const f=await fixture(t),parent=await f.svc.call('studio_generate',{soundId:f.sound.id,text:'piano',seed:42});f.jobs[0].recovery={jobId:parent.source.id,stage:'semantic'};
 const child=await f.svc.call('studio_generate',{...parent.input!,parentId:parent.id});
 const retried=await f.svc.call('studio_retry_music',{versionId:child.id,requestId:'legacy'});assert.equal(retried.id,child.id);assert.equal(retried.number,2);assert.equal(retried.parentId,parent.id);assert.equal(f.submitted.at(-1).resumeFrom,parent.source.id);
 await f.reopen();const library=await f.svc.call('studio_library',{});assert.equal(library.versions.length,2);assert.equal(library.versions.find(v=>v.id===parent.id)?.source.id,parent.source.id);
});

test('cancelled/interrupted music can retry in place; unavailable model leaves its history untouched',async t=>{
 const f=await fixture(t);
 for(const state of ['cancelled','interrupted']){
  const original=await f.svc.call('studio_generate',{soundId:f.sound.id,text:'piano',seed:42});f.jobs.at(-1).status=state;
  f.svc.yue2.status=async()=>({canGenerate:false,directory:'/installed'} as any);
  await assert.rejects(f.svc.call('studio_retry_music',{versionId:original.id}),/尚未就绪/);
  const saved=(await f.svc.call('studio_library',{})).versions.find(v=>v.id===original.id)!;assert.equal(saved.source.id,original.source.id);assert.equal(saved.musicAttempts,undefined);
  await f.reopen();const retried=await f.svc.call('studio_retry_music',{versionId:original.id,requestId:state});assert.equal(retried.id,original.id);assert.equal(retried.musicAttempts?.[0].state,state);
 }
});
