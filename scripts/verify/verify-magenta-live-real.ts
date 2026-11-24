import assert from 'node:assert/strict';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {MusicService} from '../../src/service/service.ts';
import {liveAssets} from '../../src/service/studio/live-assets.ts';
import {audioShape} from '../../src/service/studio/audio-budget.ts';
import {wavInfo} from '../../src/service/tts/speech.ts';

const [output,cache]=process.argv.slice(2);
if(!output)throw Error('用法：npm run verify:magenta-live:real -- 新验证目录 [已有模型权重目录]');
const root=resolve(output);
await mkdir(root,{mode:0o700});
if(cache)for(const [filename] of liveAssets){
 const file=join(root,'engines','magenta-live','magenta-rt-v2',filename);
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 await copyFile(join(cache,filename),file);
}
const noMusic={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const noSpeech={installed:()=>false,prepare:async()=>{},generate:async()=>{throw Error('unused');}};
const service=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('public',p)),false,noMusic,noSpeech);
try{
 await service.call('live_play_prepare',{});
 const installDeadline=Date.now()+45*60*1000;
 for(;;){
  const status=await service.call('live_play_status',{});
  if(status.installed)break;
  assert.ok(status.preparing,status.message??'模型准备未完成');
  assert.ok(Date.now()<installDeadline,'模型准备超时');
  await setTimeout(500);
 }
 const sessionId='live-real',startup=Date.now(),timings:number[]=[];
 await service.call('live_play_start',{sessionId});
 const style={left:'Acoustic jazz trio with piano, brushed drums and upright bass',right:'Upbeat disco funk, rhythmic guitar and electric bass',mix:0};
 for(let i=0;i<17;i++){
  const start=Date.now();
  for(;;){
   const result=await service.call('live_play_next',{sessionId,offset:i*48000,heardFrame:Math.max(0,i-1)*48000,style:{...style,mix:i<4?0:Math.min(1,(i-4)/5)}});
   if(result.session.phase==='failed')throw Error(result.session.message);
   if(result.block){
    assert.equal(Buffer.from(result.block.pcm,'base64').length,192000);
    assert.equal(result.block.offset,i*48000);
    timings.push(Date.now()-start);
    break;
   }
   assert.ok(Date.now()-start<50000,result.session.message);
   await setTimeout(150);
  }
 }
 const capture=await service.call('live_play_save',{sessionId,heardFrame:16*48000+24000,title:'爵士转迪斯科',requestId:'live-real-capture'});
 const bytes=service.soundLibrary.audioSync(capture.id);
 assert.deepEqual(audioShape(bytes),{frames:720000,channels:2,rate:48000});
 assert.ok(wavInfo(bytes).peak>0);
 const catalog=await service.call('sound_library_page',{filter:'kept',query:'玩一段'});
 assert.ok(catalog.items.some(entry=>entry.id===capture.id));
 await service.call('create_project',{projectId:'live-attach',title:'即兴验收'});
 const attached=await service.call('studio_attach_sound',{itemId:capture.id,projectId:'live-attach',title:capture.title,requestId:'live-real-attach'});
 assert.equal(attached.kept,true);
 assert.deepEqual(service.studio.audio(attached.id),bytes);
 const stopped=await service.call('live_play_stop',{sessionId});
 assert.equal(stopped.phase,'stopped');
 assert.equal(service.resources.snapshot().active,undefined);
 const result={fromStartMs:Date.now()-startup,blockMilliseconds:timings,peak:stopped.resource?.peak,captureId:capture.id,projectVersion:attached.id};
 await writeFile(join(root,'capture.wav'),bytes);
 await writeFile(join(root,'report.json'),JSON.stringify(result,null,2));
 console.log(result);
}finally{await service.close();}
