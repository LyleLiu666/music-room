import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createNativeSpeechDriver,nativeDistribution} from './native-runtime.ts';
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const context=()=>({signal:new AbortController().signal,stage:()=>{},report:()=>{}});
async function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'native speech ')),pack=join(folder,'pack'),root=join(folder,'engine');mkdirSync(pack);
 const wave=Buffer.alloc(46);wave.write('RIFF');wave.writeUInt32LE(38,4);wave.write('WAVE',8);wave.write('fmt ',12);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(22050,24);wave.writeUInt32LE(44100,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(2,40);wave.writeInt16LE(1200,44);
 const body=`#!${process.execPath}
const fs=require('node:fs'),http=require('node:http');
if(process.argv.includes('--version')){console.log('audio.cpp 0.9.1');process.exit(0);}
const config=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--config')+1]));
fs.appendFileSync(${JSON.stringify(join(folder,'starts'))},process.pid+'\\n');
http.createServer(async(req,res)=>{if(req.url==='/health'){res.end('{}');return;}let text='';for await(const part of req)text+=part;const data=JSON.parse(text);fs.appendFileSync(${JSON.stringify(join(folder,'requests'))},JSON.stringify(data)+'\\n');if(data.input==='hold')return;if(data.input==='fail'){res.writeHead(500);res.end('deliberate failure');return;}if(data.model!==config.models[0].id){res.writeHead(400);res.end('bad model');return;}setTimeout(()=>{res.setHeader('content-type','audio/wav');res.end(Buffer.from('${wave.toString('base64')}','base64'));},25);}).listen(config.port,config.host);
`;
 writeFileSync(join(pack,'audiocpp_server'),body,{mode:0o755});writeFileSync(join(pack,'LICENSE'),'fixture license');
 const archive=join(folder,'package.tar.gz');execFileSync('/usr/bin/tar',['-czf',archive,'-C',pack,'.']);const archiveBytes=readFileSync(archive),model=Buffer.from('fixture model');
 let wrong=false,downloads=0;
 const http=createServer((req,res)=>{downloads++;res.end(req.url==='/program'?archiveBytes:wrong?Buffer.from('bad model'):model);});await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const port=(http.address() as {port:number}).port;
 const distribution={...nativeDistribution,programUrl:`http://127.0.0.1:${port}/program`,programSha256:digest(archiveBytes),modelUrl:`http://127.0.0.1:${port}/model`,modelSha256:digest(model),modelBytes:model.length};
 const driver=createNativeSpeechDriver(process.execPath,[resolve('src/server/dev.ts'),'tts-native-worker'],undefined,{distribution});
 return {root,folder,driver,setWrong:(v:boolean)=>{wrong=v;},downloads:()=>downloads,close:async()=>{await driver.close!();await new Promise<void>(r=>http.close(()=>r()));rmSync(folder,{recursive:true,force:true});}};
}
test('native install verifies downloads and never publishes readiness for corrupt weights',async()=>{
 const f=await fixture();try{f.setWrong(true);await assert.rejects(f.driver.prepare(f.root,context()),/校验/);assert.equal(f.driver.installed(f.root),false);f.setWrong(false);await f.driver.prepare(f.root,context());assert.equal(f.driver.installed(f.root),true);const before=f.downloads();await f.driver.prepare(f.root,context());assert.equal(f.downloads(),before);writeFileSync(join(f.root,'audio-cpp','models','index-tts2-f16.gguf'),'tampered');assert.equal(f.driver.installed(f.root),false);}finally{await f.close();}
});
test('sequential native requests reuse one resident process and forward complete text and emotion',async()=>{
 const f=await fixture();try{await f.driver.prepare(f.root,context());const request={seed:42,text:'大家好我是迪丽热巴。在这个群里我最喜欢彪哥，爱你呦！',emotion:'并不悲伤，请用开心的语气',referencePath:join(f.folder,'reference.wav'),outputPath:join(f.folder,'output.wav')};for(let i=0;i<3;i++)await f.driver.generate(f.root,request,context());const starts=readFileSync(join(f.folder,'starts'),'utf8').trim().split('\n');assert.equal(starts.length,1);const requests=readFileSync(join(f.folder,'requests'),'utf8').trim().split('\n').map(l=>JSON.parse(l));assert.equal(requests.length,3);for(const r of requests){assert.equal(r.options.seed,request.seed);assert.equal(r.input,request.text);assert.equal(r.voice_ref,request.referencePath);assert.equal(r.options.emotion_text,request.emotion);assert.equal(r.options.emotion_alpha,0.6);assert.equal(r.options.num_beams,1);assert.equal(r.options.text_chunk_size,undefined);}assert.ok(statSync(request.outputPath).size>44);await assert.rejects(f.driver.generate(f.root,{...request,text:'fail'},context()),/deliberate failure/);await f.driver.generate(f.root,request,context());assert.equal(readFileSync(join(f.folder,'starts'),'utf8').trim().split('\n').length,1);}finally{await f.close();}
});
test('cancelling native computation stops its resident engine before the next task can reload',async()=>{
 const f=await fixture();try{await f.driver.prepare(f.root,context());const request={text:'hold',referencePath:join(f.folder,'reference.wav'),outputPath:join(f.folder,'output.wav')},controller=new AbortController();const running=f.driver.generate(f.root,request,{...context(),signal:controller.signal});const rejection=assert.rejects(running);for(let i=0;i<200&&!existsSync(join(f.folder,'requests'));i++)await new Promise(r=>setTimeout(r,25));setTimeout(()=>controller.abort(),100);await rejection;const first=Number(readFileSync(join(f.folder,'starts'),'utf8').trim());assert.throws(()=>process.kill(first,0));await f.driver.generate(f.root,{...request,text:'after cancellation'},context());assert.equal(readFileSync(join(f.folder,'starts'),'utf8').trim().split('\n').length,2);}finally{await f.close();}
});

test('speech FIFO, queued cancellation and a later submission all share the native resident',async()=>{
 const f=await fixture();const {ProjectStore}=await import('../projects/store.ts');const {SpeechService}=await import('./speech.ts');let service:Awaited<ReturnType<typeof SpeechService.open>>|undefined,store:Awaited<ReturnType<typeof ProjectStore.open>>|undefined;
 try{
  await f.driver.prepare(f.root,context());store=await ProjectStore.open(join(f.folder,'workspace'));service=await SpeechService.open(store,f.driver);await service.prepare(f.root);while(service.status().phase==='preparing')await new Promise(r=>setTimeout(r,10));assert.equal(service.status().canGenerate,true);
  await store.createProject('native-queue','native queue','');const sound=await service.createSound('native-queue','speech'),voice=service.addVoice('reference',readFileSync('public/tts-presets/official.wav'));
  const jobs=['first','skip me','third'].map(text=>service!.generate({soundId:sound.id,voiceId:voice.id,text}));await service.cancel(jobs[1].id);
  const deadline=Date.now()+10000;while(jobs.some(j=>['queued','running'].includes(service!.job(j.id).state))){assert.ok(service.snapshot().versions.filter(v=>v.state==='running').length<=1);if(Date.now()>deadline)throw Error('FIFO timed out');await new Promise(r=>setTimeout(r,10));}
  const later=service.generate({soundId:sound.id,voiceId:voice.id,text:'later'});while(['queued','running'].includes(service.job(later.id).state))await new Promise(r=>setTimeout(r,10));assert.equal(service.job(later.id).state,'succeeded');assert.equal(service.job(later.id).backend,'audio.cpp F16');
  const requests=readFileSync(join(f.folder,'requests'),'utf8').trim().split('\n').map(l=>JSON.parse(l));assert.deepEqual(requests.map(r=>r.input),['first','third','later']);const starts=readFileSync(join(f.folder,'starts'),'utf8').trim().split('\n');assert.equal(starts.length,1);
  await service.close();assert.throws(()=>process.kill(Number(starts[0]),0));
 }finally{await service?.close();await store?.close();await f.close();}
});

test('every resident request explicitly resets emotion controls when the next description is empty',async()=>{
 const f=await fixture();try{await f.driver.prepare(f.root,context());const request={text:'same words',referencePath:join(f.folder,'reference.wav'),outputPath:join(f.folder,'output.wav')};
  for(const emotion of ['开心、活泼',undefined,'平静、淡然'])await f.driver.generate(f.root,{...request,emotion},context());
  const requests=readFileSync(join(f.folder,'requests'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(requests.map(r=>({enabled:r.options.use_emotion_text,text:r.options.emotion_text,alpha:r.options.emotion_alpha,random:r.options.use_random_emotion})),[
   {enabled:true,text:'开心、活泼',alpha:0.6,random:false},
   {enabled:false,text:'',alpha:1,random:false},
   {enabled:true,text:'平静、淡然',alpha:0.6,random:false},
  ]);assert.equal(readFileSync(join(f.folder,'starts'),'utf8').trim().split('\n').length,1);
 }finally{await f.close();}
});
