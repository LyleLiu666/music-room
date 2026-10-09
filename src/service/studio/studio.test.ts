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
async function open(root:string){return MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,unused,speech);}
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
 const v=await svc.call('studio_generate',{soundId:a.id,text:'钢琴',instrumental:true});jobs[0].status='done';await svc.close();svc=await open(root);connect();let data=await svc.call('studio_library',{});assert.equal(data.versions.find(x=>x.id===v.id)?.state,'succeeded');assert.equal(data.versions.find(x=>x.id===v.id)?.soundId,a.id);assert.equal(data.versions.filter(x=>x.soundId===b.id).length,0);assert.equal(data.projects.length,1);
 await svc.call('studio_update_version',{versionId:v.id,final:true,kept:true});await svc.call('studio_update_version',{versionId:v.id,deleted:true});await svc.call('studio_update_version',{versionId:v.id,deleted:false});await svc.close();svc=await open(root);connect();data=await svc.call('studio_library',{});assert.equal(data.sounds.find(x=>x.id===a.id)?.finalVersionId,undefined);assert.equal(data.versions.find(x=>x.id===v.id)?.kept,true);
 }finally{await svc.close();await rm(root,{recursive:true,force:true});}
});
