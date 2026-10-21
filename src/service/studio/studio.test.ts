import {testResources} from '../resources/testing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MusicService} from '../service.ts';
import {encodeWav} from '../../wav.ts';
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const wav=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.2)],22050));
const speech={installed:()=>true,prepare:async()=>{},generate:async(_:string,r:{outputPath:string})=>{await writeFile(r.outputPath,wav);}};
async function open(root:string){return MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,speech,undefined,testResources());}
test('vocal and instrumental target duration reaches generation and persists with the original lyrics',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-duration-'));let svc=await open(root);const submitted:any[]=[];
 try{
  svc.yue2.status=async()=>({canGenerate:true} as any);
  svc.yue2Client.generate=async input=>{submitted.push(input);return {job:{id:String(submitted.length).repeat(32),kind:'create',status:'queued'}};};
  await svc.call('create_project',{projectId:'duration',title:'时长'});const s=await svc.call('studio_create_sound',{projectId:'duration',title:'音乐',kind:'music'});
  for(const instrumental of [true,false]){
   const v=await svc.call('studio_generate',{soundId:s.id,text:'民谣',lyrics:'[Verse]\n歌词原文',structure:'[Intro]\n[Outro]',instrumental,targetDuration:180});
   assert.equal(v.input?.targetDuration,180);assert.equal(v.input?.lyrics,'[Verse]\n歌词原文');
   assert.equal(submitted.at(-1).targetDuration,180);assert.equal(submitted.at(-1).instrumental,instrumental);assert.equal(submitted.at(-1).lyrics,instrumental?'[Intro]\n[Outro]':'[Verse]\n歌词原文');
  }
  await svc.close();svc=await open(root);const library=await svc.call('studio_library',{});assert.equal(library.versions.length,2);assert.ok(library.versions.every(v=>v.input?.targetDuration===180));
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('one project owns music and speech; versions retain parent, final and trash across restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-'));let svc=await open(root);
 try{
 await svc.call('create_project',{projectId:'film',title:'短片'});
 const music=await svc.call('studio_create_sound',{projectId:'film',title:'片头音乐',kind:'clip'});
 const voice=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'});
 const ref=await svc.call('tts_add_voice',{cleanup:false,name:'参考',audioBase64:Buffer.from(wav).toString('base64')});
 const v=await svc.call('studio_generate',{soundId:voice.id,text:'第一版',voiceId:ref.id});
 for(let i=0;i<100;i++){if((await svc.call('studio_library',{})).versions.find(x=>x.id===v.id)?.state==='succeeded')break;await new Promise(r=>setTimeout(r,10));}
 await svc.call('studio_update_version',{versionId:v.id,kept:true,final:true});
 const v2=await svc.call('studio_generate',{soundId:voice.id,text:'第二版',voiceId:ref.id,parentId:v.id});
 await assert.rejects(()=>svc.call('studio_generate',{soundId:music.id,text:'音乐',parentId:v.id}),/来源版本/);
 let data=await svc.call('studio_library',{});assert.equal(data.sounds.find(s=>s.id===voice.id)?.finalVersionId,v.id);assert.equal(data.versions.find(x=>x.id===v2.id)?.parentId,v.id);assert.equal(data.sounds.filter(s=>s.projectId==='film').length,2);
 await svc.call('studio_update_version',{versionId:v.id,deleted:true});
 data=await svc.call('studio_library',{});assert.equal(data.sounds.find(s=>s.id===voice.id)?.finalVersionId,undefined);assert.equal(data.versions.find(x=>x.id===v.id)?.deleted,true);
 await svc.call('studio_update_version',{versionId:v.id,deleted:false});
 await svc.close();svc=await open(root);data=await svc.call('studio_library',{});assert.equal(data.versions.find(x=>x.id===v.id)?.kept,true);assert.equal(data.sounds.find(s=>s.id===voice.id)?.finalVersionId,undefined);assert.equal(data.sounds.find(s=>s.id===music.id)?.kind,'clip');
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('legacy and imported scores keep exact ownership without creating an extra sound, and migrate once',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-score-'));let svc=await open(root);
 try{
 const original=await readFile('src/music/authoring/example.json','utf8');await svc.call('import_revision',{compositionJson:original});
 let data=await svc.call('studio_library',{});assert.equal(data.sounds.length,1);assert.equal(data.versions.length,1);
 const legacy=data.sounds[0],first=data.versions[0];await svc.call('studio_update_version',{versionId:first.id,kept:true,final:true});
 await svc.call('create_project',{projectId:'different-project',title:'完全不同的项目'});
 const newSound=await svc.call('studio_create_sound',{projectId:'different-project',title:'另一段旋律',kind:'clip'});
 const v=await svc.call('studio_import_score',{soundId:newSound.id,compositionJson:original});
 data=await svc.call('studio_library',{});assert.equal(data.sounds.length,2);assert.equal(data.versions.find(x=>x.id===v.id)?.soundId,newSound.id);assert.equal(data.sounds.find(x=>x.id===legacy.id)?.finalVersionId,first.id);
 await svc.call('studio_update_version',{versionId:first.id,deleted:true});await svc.close();svc=await open(root);data=await svc.call('studio_library',{});assert.equal(data.sounds.length,2);assert.equal(data.versions.length,2);assert.equal(data.versions.find(x=>x.id===first.id)?.deleted,true);assert.equal(data.sounds.find(x=>x.id===legacy.id)?.finalVersionId,undefined);
 assert.equal(JSON.stringify((await svc.call('get_revision',{projectId:legacy.projectId,revisionId:first.id})).composition),JSON.stringify(JSON.parse(original)));
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('music results remain in original sound when generation finishes after switching; music decisions survive restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-music-'));let svc=await open(root);const jobs:any[]=[];
 const connect=()=>{svc.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'ready',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});svc.yue2Client.list=async()=>({jobs});svc.yue2Client.generate=async()=>{const job={id:'a'.repeat(32),status:'running',kind:'create'};jobs.push(job);return {job} as any;};};connect();
 try{
 await svc.call('create_project',{projectId:'film',title:'短片'});const a=await svc.call('studio_create_sound',{projectId:'film',title:'音乐 A',kind:'clip'}),b=await svc.call('studio_create_sound',{projectId:'film',title:'音乐 B',kind:'music'});
 const v=await svc.call('studio_generate',{soundId:a.id,text:'钢琴',instrumental:true,ending:'as-described'});assert.equal(v.input?.ending,'as-described');jobs[0].status='done';jobs[0].truncated={abc:false,semantic:true};await svc.close();svc=await open(root);connect();let data=await svc.call('studio_library',{});assert.equal(data.versions.find(x=>x.id===v.id)?.state,'succeeded');assert.equal(data.versions.find(x=>x.id===v.id)?.soundId,a.id);assert.deepEqual(data.versions.find(x=>x.id===v.id)?.musicTruncated,{abc:false,semantic:true});assert.equal(data.versions.filter(x=>x.soundId===b.id).length,0);assert.equal(data.projects.length,1);
 await svc.call('studio_update_version',{versionId:v.id,final:true,kept:true});await svc.call('studio_update_version',{versionId:v.id,deleted:true});await svc.call('studio_update_version',{versionId:v.id,deleted:false});await svc.close();svc=await open(root);connect();data=await svc.call('studio_library',{});assert.equal(data.sounds.find(x=>x.id===a.id)?.finalVersionId,undefined);assert.equal(data.versions.find(x=>x.id===v.id)?.kept,true);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

async function completed(svc:MusicService,soundId:string,voiceId:string,text='正文'){
 const v=await svc.call('studio_generate',{soundId,voiceId,text,emotion:'开心'});
 for(let i=0;i<100;i++){const current=await svc.call('tts_get_version',{versionId:v.id});if(current.state==='succeeded')return current;await new Promise(r=>setTimeout(r,10));}assert.fail('generation timeout');
}
test('project and sound trash restore the prior hierarchy; archived scopes cannot generate or restore children',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-trash-'));let svc=await open(root);
 try{
  await svc.call('create_project',{projectId:'film',title:'短片'});await svc.call('create_project',{projectId:'other',title:'别的项目'});
  const s=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'}),other=await svc.call('studio_create_sound',{projectId:'other',title:'保留',kind:'clip'});
  const voice=await svc.call('tts_add_voice',{cleanup:false,name:'原音色',audioBase64:Buffer.from(wav).toString('base64')});
  const a=await completed(svc,s.id,voice.id),b=await completed(svc,s.id,voice.id);
  await svc.call('studio_update_version',{versionId:a.id,deleted:true});await svc.call('studio_update_version',{versionId:b.id,final:true});
  await svc.call('studio_update_sound',{soundId:s.id,deleted:true});
  await assert.rejects(svc.call('studio_generate',{soundId:s.id,voiceId:voice.id,text:'不应生成'}),/回收站/);
  await assert.rejects(svc.call('tts_generate',{soundId:s.id,voiceId:voice.id,text:'不应绕过'}),/回收站/);
  await svc.call('studio_update_project',{projectId:'film',deleted:true});
  await assert.rejects(svc.call('studio_update_sound',{soundId:s.id,deleted:false}),/恢复.*项目/);
  await assert.rejects(svc.call('tts_create_sound',{projectId:'film',title:'不能新建'}),/回收站/);
  await svc.close();svc=await open(root);
  await svc.call('studio_update_project',{projectId:'film',deleted:false});
  let d=await svc.call('studio_library',{});assert.equal(d.sounds.find(x=>x.id===s.id)?.deleted,true);assert.equal(d.versions.find(x=>x.id===a.id)?.deleted,true);
  await svc.call('studio_update_sound',{soundId:s.id,deleted:false,title:'改名旁白'});d=await svc.call('studio_library',{});
  assert.equal(d.sounds.find(x=>x.id===s.id)?.finalVersionId,b.id);assert.equal(d.sounds.find(x=>x.id===other.id)?.deleted,undefined);assert.equal(d.sounds.find(x=>x.id===s.id)?.title,'改名旁白');
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('voice trash and purge preserve generated audio and historical voice names without resurrecting built-ins',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-voice-trash-'));const driver={...speech,builtinVoices:async()=>[{id:'official',name:'原音色',audio:wav}]};
 const reopen=()=>MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,driver,undefined,testResources());let svc=await reopen();
 try{
  await svc.call('create_project',{projectId:'film',title:'短片'});const s=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'}),voice=(await svc.call('tts_library',{})).voices[0];const v=await completed(svc,s.id,voice.id);
  await svc.call('tts_update_voice',{voiceId:voice.id,name:'改名音色',deleted:true});
  await assert.rejects(svc.call('studio_generate',{soundId:s.id,voiceId:voice.id,text:'不可选'}),/回收站/);
  assert.equal((await svc.call('studio_library',{})).versions.find(x=>x.id===v.id)?.voiceName,'原音色');assert.deepEqual(svc.speech.audio(v.id),wav);
  await svc.call('tts_update_voice',{voiceId:voice.id,deleted:false});await svc.call('tts_update_voice',{voiceId:voice.id,deleted:true});await svc.call('studio_purge',{kind:'voice',id:voice.id});
  await assert.rejects(readFile(join(root,'speech/voices',voice.id+'.wav')),{code:'ENOENT'});await svc.close();svc=await reopen();
  assert.equal((await svc.call('tts_library',{})).voices.length,0);assert.deepEqual(svc.speech.audio(v.id),wav);assert.equal((await svc.call('studio_library',{})).versions[0].voiceName,'原音色');
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('permanent deletion requires trash and removes speech and score files; restart does not reimport purged sources',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-purge-'));let svc=await open(root);
 try{
  await svc.call('create_project',{projectId:'film',title:'短片'});const s=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'});const ref=await svc.call('tts_add_voice',{cleanup:false,name:'参考',audioBase64:Buffer.from(wav).toString('base64')});const v=await completed(svc,s.id,ref.id);
  await assert.rejects(svc.call('studio_purge',{kind:'sound',id:s.id}),/回收站/);
  await svc.call('studio_update_version',{versionId:v.id,deleted:true});await svc.call('studio_purge',{kind:'version',id:v.id});await assert.rejects(readFile(join(root,'speech/audio',v.id+'.wav')),{code:'ENOENT'});
  const score=await readFile('src/music/authoring/example.json','utf8');await svc.call('import_revision',{compositionJson:score});let d=await svc.call('studio_library',{});const legacy=d.sounds.find(x=>x.legacyProject)!;
  await svc.call('studio_update_sound',{soundId:legacy.id,deleted:true});await assert.rejects(svc.call('render_revision',{projectId:legacy.projectId,revisionId:d.versions.find(v=>v.soundId===legacy.id)!.source.id,idempotencyKey:'trash-render'}),/回收站/);await svc.call('studio_purge',{kind:'sound',id:legacy.id});
  await svc.call('studio_update_project',{projectId:'film',deleted:true});await svc.call('studio_purge',{kind:'project',id:'film'});
  await svc.close();svc=await open(root);d=await svc.call('studio_library',{});assert.equal(d.versions.length,0);assert.equal(d.sounds.length,0);assert.equal(d.projects.some(p=>p.id==='film'),false);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

test('active jobs block project, sound and voice deletion without changing their saved state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-busy-trash-'));
 const driver={...speech,generate:async(_:string,r:any,ctx:any)=>new Promise<void>((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))};
 const svc=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,driver,undefined,testResources());
 try{await svc.call('create_project',{projectId:'film',title:'短片'});const s=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'}),ref=await svc.call('tts_add_voice',{cleanup:false,name:'参考',audioBase64:Buffer.from(wav).toString('base64')});const v=await svc.call('studio_generate',{soundId:s.id,text:'进行中',voiceId:ref.id});
  for(let i=0;i<100&&svc.speech.job(v.id).state!=='running';i++)await new Promise(r=>setTimeout(r,10));
  await assert.rejects(svc.call('studio_update_project',{projectId:'film',deleted:true}),/取消|完成/);await assert.rejects(svc.call('studio_update_sound',{soundId:s.id,deleted:true}),/取消|完成/);await assert.rejects(svc.call('tts_update_voice',{voiceId:ref.id,deleted:true}),/使用|完成/);let d=await svc.call('studio_library',{});assert.equal(d.projects[0].deleted,undefined);assert.equal(d.sounds[0].deleted,undefined);assert.equal(d.voices[0].deleted,undefined);await svc.call('studio_cancel',{versionId:v.id});await svc.call('studio_update_project',{projectId:'film',deleted:true});assert.equal((await svc.call('studio_library',{})).projects[0].deleted,true);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('partially failed permanent deletion retains completed deletion receipts and can be retried',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-partial-purge-'));let svc=await open(root);const musicJob={id:'b'.repeat(32),status:'done',kind:'create'};
 svc.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'ready',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});svc.yue2Client.list=async()=>({jobs:[]});svc.yue2Client.generate=async()=>({job:musicJob}) as any;
 try{await svc.call('create_project',{projectId:'film',title:'短片'});const a=await svc.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'}),b=await svc.call('studio_create_sound',{projectId:'film',title:'配乐',kind:'music'}),ref=await svc.call('tts_add_voice',{cleanup:false,name:'参考',audioBase64:Buffer.from(wav).toString('base64')});const speechVersion=await completed(svc,a.id,ref.id),music=await svc.call('studio_generate',{soundId:b.id,text:'配乐'});
  await svc.call('studio_update_project',{projectId:'film',deleted:true});svc.yue2Client.purgeAudio=async()=>{throw Error('测试文件暂时不可删除');};await assert.rejects(svc.call('studio_purge',{kind:'project',id:'film'}),/暂时不可删除/);
  let data=await svc.call('studio_library',{});assert.equal(data.versions.some(v=>v.id===speechVersion.id),false);assert.equal(data.versions.some(v=>v.id===music.id),true);assert.equal(data.projects[0].deleted,true);
  svc.yue2Client.purgeAudio=async()=>{};await svc.call('studio_purge',{kind:'project',id:'film'});data=await svc.call('studio_library',{});assert.equal(data.projects.length,0);assert.equal(data.versions.length,0);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

test('seeded catalog projects and scores stay permanently removed after reopening the normal app',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-seed-purge-'));
 const reopen=()=>MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),true,unused,speech,undefined,testResources());let svc=await reopen();
 try{let d=await svc.call('studio_library',{});const score=d.versions.find(v=>v.source.kind==='score')!,projectId=d.sounds.find(s=>s.id===score.soundId)!.projectId;
  await svc.call('studio_update_version',{versionId:score.id,deleted:true});await svc.call('studio_purge',{kind:'version',id:score.id});await svc.close();svc=await reopen();d=await svc.call('studio_library',{});assert.equal(d.versions.some(v=>v.id===score.id),false);
  await svc.call('studio_update_project',{projectId:projectId,deleted:true});await svc.call('studio_purge',{kind:'project',id:projectId});await svc.close();svc=await reopen();d=await svc.call('studio_library',{});assert.equal(d.projects.some(p=>p.id===projectId),false);assert.equal(d.versions.some(v=>v.id===score.id),false);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

test('purged imported music stays gone when the engine reports it again; later new music gets a live project',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-music-purge-'));let svc=await open(root);const jobs=[{id:'a'.repeat(32),status:'done',kind:'create',title:'旧配乐'}];
 const connect=()=>{svc.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'ready',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});svc.yue2Client.list=async()=>({jobs}) as any;svc.yue2Client.purgeAudio=async()=>{};};connect();
 try{let d=await svc.call('studio_library',{});const p=d.projects[0];await svc.call('studio_update_project',{projectId:p.id,deleted:true});await svc.call('studio_purge',{kind:'project',id:p.id});await svc.close();svc=await open(root);connect();d=await svc.call('studio_library',{});assert.equal(d.projects.length,0);assert.equal(d.versions.length,0);
  jobs.push({id:'b'.repeat(32),status:'done',kind:'create',title:'新配乐'});await svc.close();svc=await open(root);connect();d=await svc.call('studio_library',{});assert.equal(d.projects.length,1);assert.equal(d.versions.length,1);assert.equal(d.versions[0].source.id,jobs[1].id);assert.notEqual(d.projects[0].id,p.id);assert.equal(d.projects[0].deleted,undefined);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

test('music creation preserves independent structure, actual seed and ABC through versions and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-music-controls-'));let svc=await open(root);const calls:any[]=[];
 try{
  svc.yue2.status=async()=>({canGenerate:true}) as any;
  svc.yue2Client.generate=async input=>{calls.push(input);return {job:{id:'a'.repeat(32),status:'queued',kind:'create'}};};
  await svc.call('create_project',{projectId:'film',title:'短片'});const s=await svc.call('studio_create_sound',{projectId:'film',title:'音乐',kind:'music'});
  const input={soundId:s.id,text:'piano',structure:'[Intro]\n[Verse]\n[Outro]',lyrics:'旧歌词不能被唱出',instrumental:true,seed:0,abc:'X:1\nM:4/4\nL:1/4\nK:C\nC D E F|'};
  const v=await svc.call('studio_generate',input);
  assert.equal(calls[0].lyrics,input.structure);assert.equal(calls[0].seed,0);assert.equal(calls[0].abc,input.abc);assert.equal(v.input?.structure,input.structure);
  await svc.call('studio_generate',{...input,instrumental:false,seed:undefined,abc:undefined});
  assert.equal(calls[1].lyrics,input.lyrics);assert.ok(Number.isInteger(calls[1].seed));
  const draft=(await svc.call('studio_library',{})).versions.at(-1)!.input!;assert.equal(draft.seed,calls[1].seed);
  for(const instrumental of [true,undefined]){await svc.call('studio_generate',{...input,structure:' ',instrumental});assert.equal(calls.at(-1).lyrics,'[instrumental]');assert.equal(calls.at(-1).instrumental,true);}
  await svc.close();svc=await open(root);const restored=(await svc.call('studio_library',{})).versions.find(x=>x.id===v.id)!;assert.equal(restored.input?.seed,0);assert.equal(restored.input?.abc,input.abc);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

test('music phase progress reaches both selected versions and global background tasks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'studio-music-progress-'));const svc=await open(root);let now=Date.parse('2026-10-11T14:52:30Z');
 t.mock.method(Date,'now',()=>now);
 try{
  const job={id:'a'.repeat(32),kind:'create',status:'running' as const,started_at:'2026-10-11T14:40:59Z',checkedAt:now,progress:{type:'stage',stage:'synthesize',completed:12,total:32,unit:'steps',seconds:333.312,ts:'2026-10-11T14:52:28Z'}};
  svc.yue2.status=async()=>({canGenerate:true}) as any;
  let submitted=false;svc.yue2Client.generate=async()=>{submitted=true;return {job};};svc.yue2Client.list=async()=>({jobs:submitted?[job]:[]});
  await svc.call('create_project',{projectId:'film',title:'短片'});const sound=await svc.call('studio_create_sound',{projectId:'film',title:'音乐',kind:'music'});
  const version=await svc.call('studio_generate',{soundId:sound.id,text:'piano'});now+=3000;
  const library=await svc.call('studio_library',{});
  assert.equal(library.versions.find(v=>v.id===version.id)?.musicProgress?.completed,12);
  assert.equal(library.backgroundVersions.find(v=>v.id===version.id)?.musicProgress?.startedAt,Date.parse(job.started_at));
  job.status='done' as any;now+=3000;const done=await svc.call('studio_library',{});assert.equal(done.versions.find(v=>v.id===version.id)?.musicProgress,undefined);assert.equal(done.backgroundVersions.length,0);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});

test('instrumental versions cannot start lyric alignment, including default mode and stale drafts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-instrumental-lyrics-'));const svc=await open(root);
 try{
  svc.yue2.status=async()=>({canGenerate:true}) as any;
  svc.yue2Client.generate=async()=>({job:{id:'a'.repeat(32),status:'done',kind:'create'}});
  await svc.call('create_project',{projectId:'film',title:'短片'});
  const sound=await svc.call('studio_create_sound',{projectId:'film',title:'配乐',kind:'music'});
  for(const instrumental of [true,undefined]){
   const v=await svc.call('studio_generate',{soundId:sound.id,text:'钢琴',instrumental,lyrics:'旧歌词'});
   assert.equal(v.input?.instrumental,true);
   assert.equal(svc.studio.lyrics(v.id).canGenerate,false);
   assert.equal(svc.studio.lyrics(v.id).kind,'none');
   assert.throws(()=>svc.studio.lyricSource(v.id),/参考歌词/);
  }
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
test('task history survives reopening and conversion pagination without exposing generation inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-task-history-'));let svc=await open(root);
 try{
  await svc.call('create_project',{projectId:'history',title:'任务历史'});
  const sound=await svc.call('studio_create_sound',{projectId:'history',title:'音乐',kind:'music'});
  await svc.close();
  const file=join(root,'studio.json'),data=JSON.parse(await readFile(file,'utf8'));
  data.versions.push({id:'history-version',soundId:sound.id,number:1,state:'failed',stage:'生成失败',createdAt:'2026-10-20T01:00:00Z',source:{kind:'music',id:''},input:{text:'private prompt'}});
  await writeFile(file,JSON.stringify(data));svc=await open(root);
  const snapshot=await svc.call('studio_library',{paginateConversions:true});
  assert.equal(snapshot.taskHistory.length,1);assert.equal(snapshot.taskHistory[0].id,'history-version');assert.equal(snapshot.taskHistory[0].state,'failed');assert.equal('input' in snapshot.taskHistory[0],false);
  await svc.call('studio_update_version',{versionId:'history-version',deleted:true});assert.equal((await svc.call('studio_library',{})).taskHistory.length,0);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
