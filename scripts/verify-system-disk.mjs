// Opt-in destructive writes are restricted to a fresh 64 MiB RAM disk created here.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,open,statfs,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ProjectStore} from '../src/service/projects/store.ts';
import {checkDisk} from '../src/service/resources/installation.ts';
import {SpeechService} from '../src/service/tts/speech.ts';
import {createSpeechDriver} from '../src/service/tts/runtime.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {installNative,nativeInstalled} from '../src/service/tts/native-install.ts';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
if(process.env.MUSIC_ROOM_SYSTEM_DISK!=='1'||process.platform!=='darwin')throw Error('Set MUSIC_ROOM_SYSTEM_DISK=1 on macOS');
const out=resolve('test-results/system-disk');await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),status:'running',checks:[]};
const mount=await mkdtemp(join(tmpdir(),'music-qa-volume-'));
let device,store;
try{
 const attached=execFileSync('/usr/bin/hdiutil',['attach','-nomount','ram://131072'],{encoding:'utf8'});
 device=attached.match(/^\/dev\/disk\d+\s/m)?.[0].trim();assert.ok(device,'fresh RAM device required');
 execFileSync('/usr/sbin/diskutil',['eraseVolume','HFS+','MUSIC_QA_FULL',device]);
 execFileSync('/usr/sbin/diskutil',['unmount',device]);
 execFileSync('/usr/sbin/diskutil',['mount','-mountPoint',mount,device]);
 const fs=await statfs(mount);assert.ok(Number(fs.blocks)*Number(fs.bsize)<=128*2**20);
 report.volume={kind:'64 MiB RAM disk',bytes:Number(fs.blocks)*Number(fs.bsize)};
 store=await ProjectStore.open(join(mount,'workspace'));await store.createProject('preserved','已有项目');
 const target=store.path('saved.json'),original={version:1,value:'已有保存记录'};store.atomicJSON(target,original);
 assert.throws(()=>checkDisk(mount,1),{code:'INSUFFICIENT_DISK'});report.checks.push('real target-volume preflight rejects installation/download below the 2 GiB reserve');
 const resources=testResources();resources.checkDisk=checkDisk;
 const native=createSpeechDriver(),speech=await SpeechService.open(store,native,()=>false,resources);
 try{
  assert.equal(speech.status().canGenerate,true,'installed native model required for this admission check');
  const voice=speech.addVoice('固定参考',new Uint8Array(await readFile(resolve('public/tts-presets/official.wav')))),sound=await speech.createSound('preserved','低磁盘语音');
  const job=speech.generate({soundId:sound.id,voiceId:voice.id,text:'磁盘不足时不应该加载模型。',seed:42});
  let result;for(let i=0;i<200;i++){result=speech.job(job.id);if(result.state==='failed')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(result.state,'failed');assert.equal(result.resource.reason,'INSUFFICIENT_DISK');assert.deepEqual(resources.snapshot().residents,[]);
  report.checks.push('installed real TTS configuration rejects low workspace disk before native model load');
 }finally{await speech.close();await resources.close();}
 const filler=join(mount,'filler'),file=await open(filler,'wx');let written=0;
 try{for(;;){const {bytesWritten}=await file.write(Buffer.alloc(1024*1024,0xa5));written+=bytesWritten;}}
 catch(error){assert.equal(error.code,'ENOSPC');}finally{await file.close();}
 report.fillerBytes=written;
 assert.throws(()=>store.atomicJSON(target,{version:2,value:'x'.repeat(2*2**20)}),{code:'ENOSPC'});
 assert.deepEqual(JSON.parse(await readFile(target,'utf8')),original);
 assert.equal((await readdir(store.root)).some(p=>p.endsWith('.tmp')),false);
 report.checks.push('actual ENOSPC leaves previous JSON byte content intact and removes incomplete temporary records');
 await rm(filler);store.atomicJSON(target,{version:2,value:'释放空间后保存成功'});
 assert.equal(JSON.parse(await readFile(target,'utf8')).version,2);
 await store.close();store=await ProjectStore.open(join(mount,'workspace'));
 assert.equal((await store.project('preserved')).title,'已有项目');
 assert.equal(JSON.parse(await readFile(store.path('saved.json'),'utf8')).value,'释放空间后保存成功');
 report.checks.push('release space, retry, close and reopen preserve old project and new saved result');report.status='passed';
 // Exercise the real download writer losing space after admission. Test weights
 // are deliberately small; this is filesystem behavior, not model inference.
 const engine=join(mount,'fixture-engine'),base=join(engine,'audio-cpp'),program=join(base,'release/audiocpp_server'),model=join(base,'models/index-tts2-f16.gguf');
 await mkdir(join(base,'release'),{recursive:true});await mkdir(join(base,'models'),{recursive:true});
 await writeFile(program,'previous program');await writeFile(model,'previous model');
 const digest=x=>createHash('sha256').update(x).digest('hex'),stamp=async p=>{const s=await (await import('node:fs/promises')).stat(p);return {bytes:s.size,mtimeMs:s.mtimeMs};};
 const old={version:'old-fixture',programUrl:'unused',programSha256:'old-fixture',modelUrl:'unused',modelSha256:digest('previous model'),modelBytes:14};
 await writeFile(join(base,'installed.json'),JSON.stringify({engine:'audio.cpp',version:old.version,precision:'f16',programSha256:old.programSha256,modelSha256:old.modelSha256,program:await stamp(program),model:await stamp(model)}));assert.equal(nativeInstalled(engine,old),true);
 const pack=join(mount,'pack');await mkdir(pack);await writeFile(join(pack,'audiocpp_server'),'replacement program');const archive=join(mount,'program.tar.gz');execFileSync('/usr/bin/tar',['-czf',archive,'-C',pack,'audiocpp_server']);const archiveBytes=await readFile(archive);
 const chunk=Buffer.alloc(65536,0x5a),hash=createHash('sha256');for(let i=0;i<512;i++)hash.update(chunk);
 const server=createServer((_,response)=>{response.writeHead(200,{'content-type':'application/octet-stream'});Readable.from((async function*(){for(let i=0;i<512&&!response.destroyed;i++)yield chunk;})()).pipe(response);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const next={...old,version:'new-fixture',programSha256:digest(archiveBytes),modelUrl:`http://127.0.0.1:${server.address().port}/chunked`,modelSha256:hash.digest('hex'),modelBytes:32*2**20};
  const fs=await statfs(mount),toFill=Math.max(0,Number(fs.bavail)*Number(fs.bsize)-8*2**20),handle=await open(filler,'wx');
  try{for(let n=0;n<Math.floor(toFill/chunk.length);n++)await handle.write(chunk);}finally{await handle.close();}
  const context={signal:new AbortController().signal,stage:()=>{},report:()=>{}};
  await assert.rejects(installNative(engine,context,next,async()=>archiveBytes),{code:'ENOSPC'});
  assert.equal(nativeInstalled(engine,old),true);assert.equal(await readFile(model,'utf8'),'previous model');assert.equal(await readFile(program,'utf8'),'previous program');
  report.checks.push('chunked HTTP download hits actual ENOSPC mid-stream; previous installed program and model remain ready (32 MiB fixture weights)');
  await rm(filler);await installNative(engine,context,next,async()=>archiveBytes);assert.equal(nativeInstalled(engine,next),true);
  report.checks.push('after releasing space, the same real download/install writer retries and publishes only the complete verified fixture');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{
 await store?.close();if(device)execFileSync('/usr/bin/hdiutil',['detach',device]);await rm(mount,{recursive:true,force:true});
 report.finishedAt=new Date().toISOString();await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
