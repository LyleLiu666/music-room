import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {SpeechService} from './speech.ts';
import {testResources} from '../resources/testing.ts';
import {ResourceError} from '../resources/contracts.ts';
import {encodeWav} from '../../wav.ts';

test('low workspace disk rejects speech before model load and an explicit retry succeeds after space is released',async()=>{
 const root=await mkdtemp(join(tmpdir(),'speech-disk-')),store=await ProjectStore.open(root),resources=testResources();
 let low=true,loaded=0;const checked:Array<{directory:string;bytes:number}>=[];
 resources.checkDisk=(directory,bytes)=>{checked.push({directory,bytes});if(low)throw new ResourceError('INSUFFICIENT_DISK','安装磁盘空间不足；请释放空间或选择其他目录');return 100*2**30;};
 const wave=new Uint8Array(encodeWav([new Float32Array(22050).fill(.1)],22050));
 const speech=await SpeechService.open(store,{installed:()=>true,prepare:async()=>{},generate:async(_,request)=>{loaded++;await writeFile(request.outputPath,wave);}},()=>false,resources);
 const wait=async(id:string)=>{for(let i=0;i<200;i++){const job=speech.job(id);if(['succeeded','failed'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('timeout');};
 try{
  await store.createProject('disk','磁盘保护');const sound=await speech.createSound('disk','旁白'),voice=speech.addVoice('参考',wave);
  const rejected=speech.generate({soundId:sound.id,voiceId:voice.id,text:'磁盘不足时不加载模型'});
  assert.equal((await wait(rejected.id)).state,'failed');assert.equal(loaded,0);assert.deepEqual(checked,[{directory:store.root,bytes:256*2**20}]);
  low=false;const retry=speech.generate({soundId:sound.id,voiceId:voice.id,text:rejected.text,parentId:rejected.id});
  assert.equal((await wait(retry.id)).state,'succeeded');assert.equal(loaded,1);assert.deepEqual(speech.audio(retry.id),wave);assert.equal(speech.job(rejected.id).state,'failed');
 }finally{await speech.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});}
});
