// Explicit test-only service process. Model drivers are deterministic fixtures.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join,basename,isAbsolute} from 'node:path';
import {MusicService} from '../../service/service.ts';
import {serveHttp} from '../http.ts';
import {testResources} from '../../service/resources/testing.ts';
import {probeHardware} from '../../service/resources/telemetry.ts';
import {nativeFootprint} from '../../service/resources/native-telemetry.ts';
import {encodeWav} from '../../wav.ts';
const root=process.argv[2],scale=Number(process.argv[3]);
assert.ok(isAbsolute(root)&&basename(root).startsWith('studio-soak-'));
assert.ok(Number.isSafeInteger(scale)&&scale>=100&&scale<=20000);
const wav=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.1)],22050));
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const speech={installed:()=>true,prepare:async()=>{},generate:async(_,request,context)=>{
 await new Promise((resolve,reject)=>{const done=()=>{context.signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,25);const abort=()=>{clearTimeout(timer);reject(context.signal.reason);};context.signal.addEventListener('abort',abort,{once:true});if(context.signal.aborted)abort();});
 await writeFile(request.outputPath,wav);
}};
const assets={read:async()=>new Uint8Array(),has:()=>false,embedded:false};
const open=()=>MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,speech,undefined,testResources());
const telemetry=process.platform==='darwin'?nativeFootprint():undefined;
let service=await open(),http,closing;
if(!existsSync(join(root,'studio.json'))){
 const sounds=[],versions=[];
 for(let p=0;p<10;p++)await service.store.createProject(`scale-${p}`,`规模项目 ${p}`);
 for(let i=0;i<scale;i++){
  const s=Math.floor(i/20),id=`scale-sound-${s}`;if(i%20===0)sounds.push({id,projectId:`scale-${s%10}`,title:`规模声音 ${s}`,kind:'conversion',createdAt:'2026-10-10T00:00:00Z'});
  versions.push({id:`scale-version-${i}`,soundId:id,number:i%20+1,createdAt:new Date(1700000000000+i*1000).toISOString(),state:'failed',stage:'固定规模样本',kept:false,deleted:false,source:{kind:'conversion',id:`scale-job-${i}`}});
 }
 service.store.atomicJSON(service.store.path('studio.json'),{format:'music-room-studio',version:1,sounds,versions});await service.close();service=await open();
}
http=await serveHttp(service,assets);
const endpoint=()=>({url:http.runtime.url,token:http.runtime.token,pid:process.pid});
const stop=()=>closing??=(async()=>{await http.close();await service.close();await telemetry?.close();})();
process.on('disconnect',()=>{void stop().finally(()=>process.exit(0));});
process.on('SIGTERM',()=>{void stop().finally(()=>process.exit(0));});
let pending=Promise.resolve();
process.on('message',message=>{pending=pending.then(async()=>{
 try{
  let result;
  if(message.type==='restart'){await http.close();await service.close();service=await open();http=await serveHttp(service,assets);result=endpoint();}
  else if(message.type==='memory'){
   global.gc?.();result={memory:process.memoryUsage()};
   if(message.hardware)for(let attempt=0;attempt<2;attempt++)try{result.hardware=await probeHardware(telemetry?.measure,telemetry?.system);break;}catch(error){(result.hardwareErrors??=[]).push(String(error));if(attempt===1)throw error;}
  }else if(message.type==='close'){await stop();process.send({id:message.id,result:{closed:true}},()=>process.exit(0));return;}
  else throw Error('Unknown soak protocol operation');
  process.send({id:message.id,result});
 }catch(error){process.send({id:message.id,error:String(error)});}
});});
process.send({type:'ready',result:endpoint()});
