import assert from 'node:assert/strict';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {MusicService} from '../../src/service/service.ts';
import {hash} from '../../src/service/projects/store.ts';
import {audioShape} from '../../src/service/studio/audio-budget.ts';
import {coverModel} from '../../src/service/studio/ace-cover.ts';

const [source,output,cache]=process.argv.slice(2);
if(!source||!output)throw Error('用法：npm run verify:ace-cover:real -- 原唱.wav 新验证目录 [已有模型缓存目录]');
const root=resolve(output);
await mkdir(root,{mode:0o700}); // Never write into an existing workspace.
const models=join(root,'engines','ace-cover','models');
await mkdir(models,{recursive:true,mode:0o700});
if(cache)for(const filename of [coverModel,'Qwen3-Embedding-0.6B-Q8_0.gguf','vae-BF16.gguf'])await copyFile(join(cache,filename),join(models,filename));
const original=await readFile(source),{rate,frames}=audioShape(original);
assert.ok(frames/rate>=15);
const noMusic={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const noSpeech={installed:()=>false,prepare:async()=>{},generate:async()=>{throw Error('unused');}};
const open=()=>MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,noMusic,noSpeech);
let service=await open();
try{
 await service.call('create_project',{projectId:'cover-check',title:'翻唱验收'});
 const sound=await service.call('studio_create_sound',{projectId:'cover-check',title:'原唱',kind:'music'});
 const index=join(root,'studio.json'),data=JSON.parse(await readFile(index,'utf8'));
 data.sounds[0].finalVersionId='cover-source';
 data.versions.push({id:'cover-source',soundId:sound.id,number:1,createdAt:new Date().toISOString(),state:'succeeded',stage:'已完成',kept:false,deleted:false,duration:frames/rate,source:{kind:'audio',id:'cover-source'},audioPath:'/studio-audio/cover-source',audioHash:hash(original)});
 await service.close();
 await mkdir(join(root,'studio-audio'));
 await writeFile(join(root,'studio-audio','cover-source.wav'),original);
 await writeFile(index,JSON.stringify(data));
 service=await open();
 await service.call('ace_cover_prepare',{});
 const installDeadline=Date.now()+45*60*1000;
 for(;;){
  const status=await service.call('ace_cover_status',{});
  if(status.installed)break;
  assert.equal(status.preparation?.state,'preparing',status.preparation?.message??'模型准备未完成');
  assert.ok(Date.now()<installDeadline,'模型准备超时');
  await setTimeout(500);
 }
 const request={versionId:'cover-source',requestId:'real-cover',startSeconds:0,endSeconds:15,style:'Mandarin female lead with a raspy low alto, clear consonants, live rock band, overdriven guitars, punchy bass and acoustic drums',lyrics:'[Verse]\n周六的阳光爬上窗沿\n你把帐篷绑在车后架\n两瓶汽水在车筐里晃\n车铃一响 我们出发',strength:'balanced' as const};
 const started=Date.now(),version=await service.call('studio_cover_generate',request);
 for(;;){
  assert.ok(Date.now()-started<120000,'翻唱超时');
  const snapshot=await service.call('studio_library',{});
  const result=snapshot.versions.find(v=>v.id===version.id)!;
  if(result.state==='failed')throw Error(result.error);
  if(result.state==='succeeded'){
   assert.equal(result.parentId,'cover-source');assert.equal(result.duration,15);
   assert.equal(snapshot.sounds[0].finalVersionId,'cover-source');
   assert.equal(hash(service.studio.audio('cover-source')),hash(original));
   assert.deepEqual(audioShape(service.studio.audio(result.id)),{frames:720000,rate:48000,channels:2});
   await writeFile(join(root,'report.json'),JSON.stringify({duration:result.duration,elapsedMs:Date.now()-started,peak:result.resource?.peak,state:result.resource?.stage},null,2));
   console.log(await readFile(join(root,'report.json'),'utf8'));
   break;
  }
  await setTimeout(300);
 }
}finally{await service.close();}
