import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {constants,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {MusicService} from '../../src/service/service.ts';
import {serveHttp} from '../../src/server/http.ts';
import {effectWeights} from '../../src/service/studio/sound-effects-assets.ts';
import type {ResourceTaskState} from '../../src/service/resources/contracts.ts';
import {audioShape} from '../../src/service/studio/audio-budget.ts';
import {createEffectDriver} from '../../src/service/studio/sound-effects-runtime.ts';
import {createWorkspaceBackup,restoreWorkspaceBackup} from '../../src/server/workspace-backup.ts';
import {processIdentity} from '../../src/service/resources/lease.ts';
import {groupMembers} from '../../src/service/resources/processes.ts';

// Run one owned, isolated workspace; existing cached files are only copied, never modified.
const evidence=resolve('test-results/sound-effects-integration-2026-11-08/real',`run-${Date.now()}`);await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'music-sfx-real-')),workspace=join(root,'workspace'),engine=join(root,'engine');
const archive=process.env.MUSIC_ROOM_SFX_TEST_ARCHIVE,cache=process.env.MUSIC_ROOM_SFX_TEST_CACHE;
const assets={read:(path:string)=>readFile(resolve('dist',path)),has:(path:string)=>existsSync(resolve('dist',path)),embedded:false};
let service:MusicService|undefined,http:Awaited<ReturnType<typeof serveHttp>>|undefined,client:Client|undefined;
const report:Record<string,unknown>={workspace,engine,preseeded:!!(archive&&cache),startedAt:new Date().toISOString(),model:'Stable Audio 3 Small-SFX',results:[]};
try{
 if(Boolean(archive)!==Boolean(cache))throw Error('需要同时提供音效程序归档和权重缓存，或两项均不提供');
 if(archive&&cache){await mkdir(join(engine,'downloads'),{recursive:true});await mkdir(join(engine,'weights'),{recursive:true});await copyFile(archive,join(engine,'downloads','source.tar.gz'),constants.COPYFILE_FICLONE);for(const w of effectWeights)await copyFile(join(cache,w.sha256),join(engine,'weights',w.name),constants.COPYFILE_FICLONE);}
 service=await MusicService.open(workspace,()=>{throw Error('unused');},assets.read,false,undefined,undefined,undefined,undefined,undefined,createEffectDriver(engine));http=await serveHttp(service,assets);client=new Client({name:'sound-effects-real',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(http.runtime.url+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${http.runtime.token}`}}}));
 const call=async(name:string,args:Record<string,unknown>={})=>{const r=await client!.callTool({name,arguments:args});if(r.isError)throw Error(JSON.stringify(r.content));return JSON.parse((r.content as any)[0].text);};
 const initial=await call('sound_effect_status');assert.equal(initial.installed,false);assert.equal(initial.directory,engine);await call('sound_effect_prepare');
 const until=Date.now()+15*60_000;let state:any;let last='';
 while(Date.now()<until){state=await call('sound_effect_status');if(state.preparation.message!==last){last=state.preparation.message;console.log('准备:',last);}if(state.installed)break;if(['failed','cancelled'].includes(state.preparation.state))throw Error(state.preparation.message);await new Promise(r=>setTimeout(r,1000));}
 assert.equal(state.installed,true,'模型准备超时');report.preparation=state.preparation;
 await call('create_project',{projectId:'real-office',title:'真实音效验收'});const sound=await call('studio_create_sound',{projectId:'real-office',title:'碎纸机',kind:'effect'});
 for(const [name,prompt,seconds,seed] of [['bubble','One low hollow water cooler bubble, close up, no music.',3,303],['paper','An office paper shredder tearing paper, close up, no music.',5,505]] as const){
  const submitted=await call('sound_effect_generate',{requestId:`real-${name}`,title:`真实验收 ${name}`,prompt,seconds,seed,...(name==='paper'?{soundId:sound.id}:{})});let job:any;const deadline=Date.now()+120_000;
  while(Date.now()<deadline){job=await call('sound_effect_job',{jobId:submitted.id});if(!['queued','running'].includes(job.state))break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(job.state,'succeeded',JSON.stringify(job));assert.equal(job.item.origin,'sound-effect');assert.equal(job.item.source.kind,'sound-effect');assert.equal(job.item.source.seed,seed);assert.equal(job.item.source.seconds,seconds);assert.ok(Number.isSafeInteger(job.processPeakBytes)&&job.processPeakBytes>0&&job.processPeakBytes<=5_000_000_000);
  const response:Response=await fetch(http.runtime.url+job.item.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer()),shape=audioShape(bytes,5);assert.equal(shape.frames,seconds*shape.rate);assert.ok(bytes.some((v,i)=>i>44&&v!==0));
  await writeFile(join(evidence,`${name}.wav`),bytes);const history:ResourceTaskState|undefined=service.resources.snapshot().history.find(x=>x.id===job.id);assert.ok(history?.peak?.memory!==undefined);assert.ok(history.peak.memory<=5_000_000_000);(report.results as unknown[]).push({name,seconds,seed,jobId:job.id,resourcePeakBytes:history.peak.memory,processPeakBytes:job.processPeakBytes,bytes:bytes.length});console.log(name,'完成，采样内存峰值',history.peak.memory);
  if(name==='paper'){const studio=await call('studio_library');assert.equal(studio.versions.find((v:any)=>v.id===job.id)?.soundId,sound.id);const trimmed=await call('studio_trim_audio',{versionId:job.id,startSeconds:1,endSeconds:3,requestId:'real-paper-trim'});assert.equal(trimmed.duration,2);assert.equal(trimmed.parentId,job.id);const clip:Response=await fetch(http.runtime.url+trimmed.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});assert.equal(clip.status,200);const clipped=Buffer.from(await clip.arrayBuffer()),clipShape=audioShape(clipped,5);assert.equal(clipShape.frames,clipShape.rate*2);await writeFile(join(evidence,'paper-trim.wav'),clipped);report.project={soundId:sound.id,versionId:job.id,trimmedId:trimmed.id};}
 }
 await call('resource_pause');const queued=await call('sound_effect_generate',{requestId:'real-queued-cancel',title:'取消的排队任务',prompt:'Rain falling',seconds:3,seed:1});assert.equal(queued.state,'queued');await call('resource_cancel',{taskId:queued.id});assert.equal((await call('sound_effect_job',{jobId:queued.id})).state,'cancelled');await call('resource_resume');
 const running=await call('sound_effect_generate',{requestId:'real-running-cancel',title:'取消的运行任务',prompt:'A paper shredder',seconds:5,seed:2});const leasePath=join(homedir(),'Library','Application Support','MusicRoom','resources','heavy-task.json');let workers:{pid:number;started:string;group?:boolean}[]=[];
 for(let i=0;i<500&&!workers.length;i++){try{const lease=JSON.parse(await readFile(leasePath,'utf8'));if(lease.parent.pid===process.pid)workers=lease.workers??[];}catch{/* The scheduler has not yet published the lease. */}if(!workers.length)await new Promise(r=>setTimeout(r,10));}
 assert.ok(workers.length,'未观察到真实音效模型所属进程');const cancelled=await call('sound_effect_cancel',{jobId:running.id});assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.item,undefined);
 for(const worker of workers){assert.notEqual(processIdentity(worker.pid)?.started,worker.started,'取消后模型进程仍在运行');if(worker.group)assert.deepEqual(groupMembers(worker.pid),[],'取消后模型进程组仍未退出');}assert.equal(service.resources.snapshot().active,undefined);report.cancellation='queued and running tasks cancelled; tracked workers exited';
 await client.close();client=undefined;await http.close();http=undefined;await service.close();service=undefined;
 service=await MusicService.open(workspace,()=>{throw Error('unused');},assets.read,false,undefined,undefined,undefined,undefined,undefined,createEffectDriver(engine));const reopened=service.effects.status();assert.equal(reopened.jobs.filter(j=>j.state==='succeeded').length,2);assert.equal(service.soundLibrary.list().filter(x=>x.source?.kind==='sound-effect').length,2);assert.equal((await service.call('studio_library',{})).versions.filter(v=>v.soundId===sound.id).length,2);report.restart='both recordings and the project trim recovered';await service.close();service=undefined;const backup=join(root,'backup'),restored=join(root,'restored');await createWorkspaceBackup({sourceDirectory:workspace,destinationDirectory:backup});await restoreWorkspaceBackup({backupDirectory:backup,destinationDirectory:restored});service=await MusicService.open(restored,()=>{throw Error('unused');},assets.read,false,undefined,undefined,undefined,undefined,undefined,createEffectDriver(engine));assert.equal(service.effects.status().jobs.filter(j=>j.state==='succeeded').length,2);assert.equal(service.soundLibrary.list().filter(x=>x.origin==='sound-effect').length,2);assert.equal((await service.call('studio_library',{})).versions.filter(v=>v.soundId===sound.id).length,2);report.backup='recordings, project versions and trim restored; model environment remained outside workspace';report.result='passed';
}catch(error){report.result='failed';report.error=String(error instanceof Error?error.stack:error);throw error;}
finally{await client?.close().catch(()=>{});await http?.close().catch(()=>{});await service?.close().catch(()=>{});await writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2));await rm(root,{recursive:true,force:true});}
