import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {lyricsReviewCredentials,createLyricsReviewer,parseLyricMapping,applyReviewedMapping,type TranscriptChunk} from './lyrics-review.ts';

const reference='[Chorus]\n把周末铺在湖边\n野餐垫鼓起一面帆\n你追着帽子跑一圈';
const chunk:TranscriptChunk={start:50,end:80,text:'把周末铺在湖边。夜三点的起面粉。你追着帽子跑一圈',rawText:'原始识别',referenceContext:reference,parts:['把周末铺在湖边','夜三点的起面粉','你追着帽子跑一圈']};
const mapping=(middle=1)=>JSON.stringify({groups:[{ids:[0],status:'matched',matches:[{line:0}]},{ids:[1],status:'matched',matches:[{line:middle}]},{ids:[2],status:'matched',matches:[{line:2}]}]});

test('only original lyric text can be rendered; model text, omissions, duplication and truncation are rejected',()=>{
 const parsed=parseLyricMapping(mapping(),reference,chunk.parts);
 assert.deepEqual(applyReviewedMapping(chunk,parsed,parsed).parts,['把周末铺在湖边','野餐垫鼓起一面帆','你追着帽子跑一圈']);
 for(const bad of ['{}','{"groups":[]}',mapping().slice(0,-4),mapping().replace('"line":1','"line":999'),mapping().replace('"line":1','"line":1,"text":"编造的新歌词"'),mapping().replace('"ids":[1]','"ids":[0]')])assert.throws(()=>parseLyricMapping(bad,reference,chunk.parts));
});

test('disagreement retains the actual ASR text and flags it instead of applying either guess',()=>{
 const first=parseLyricMapping(mapping(),reference,chunk.parts),second=parseLyricMapping(mapping(2),reference,chunk.parts);
 const reviewed=applyReviewedMapping(chunk,first,second);
 assert.equal(reviewed.parts[1],chunk.parts[1]);assert.equal(reviewed.review.needsReview,1);
 assert.equal(reviewed.parts[0],chunk.parts[0]);
});

test('split fragments can join one source line and repeated performances remain separate',()=>{
 const words=['我喊慢一点','慢一点','我喊慢一点','慢一点'];
 const content=JSON.stringify({groups:[{ids:[0,1],status:'matched',matches:[{line:0}]},{ids:[2,3],status:'matched',matches:[{line:0}]}]});
 const parsed=parseLyricMapping(content,'我喊慢一点 慢一点',words);
 const result=applyReviewedMapping({...chunk,parts:words},parsed,parsed);
 assert.deepEqual(result.parts,['我喊慢一点 慢一点','我喊慢一点 慢一点']);
});

test('two rounds use the selected Cloudflare model, retain history, cache validated responses and keep secrets out of persisted data',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-review-'));let calls=0;
 try{
  const reviewer=createLyricsReviewer({directory,credentials:()=>({account:'a'.repeat(32),token:'private-test-token'}),fetch:async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));assert.equal(body.stream,false);assert.ok(body.max_completion_tokens);assert.equal(body.chat_template_kwargs.enable_thinking,false);assert.equal(body.response_format.type,'json_object');assert.equal(body.messages.length,calls===1?2:4);
   return Response.json({success:true,result:{response:mapping(),choices:[{finish_reason:'stop'}],usage:{neurons:10}}});
  }});
  const progress:{message:string;percent:number}[]=[];
  const result=await reviewer.review(reference,[chunk],new AbortController().signal,(message,percent)=>progress.push({message,percent}));
  assert.deepEqual(progress,[{message:'正在核对歌词 · 1 / 1 段',percent:55}]);
  assert.equal(result.chunks[0].parts[1],'野餐垫鼓起一面帆');assert.equal(result.summary.model,'@cf/qwen/qwen3.8-27b');assert.equal(calls,2);
  await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});assert.equal(calls,2);
  assert.ok(!readFileSync(join(directory,'usage.json'),'utf8').includes('private-test-token'));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('an exhausted allowance prevents inference; HTTP quota errors and cancellation stop without a fallback model',async()=>{
 for(const scenario of ['budget','quota','cancel'] as const){
  const directory=mkdtempSync(join(tmpdir(),'lyrics-review-'));let calls=0;const controller=new AbortController();if(scenario==='cancel')controller.abort();
  try{
   const reviewer=createLyricsReviewer({directory,dailyLimit:scenario==='budget'?1:9500,credentials:()=>({account:'a'.repeat(32),token:'secret'}),fetch:async()=>{calls++;return new Response('{}',{status:429});}});
   await assert.rejects(reviewer.review(reference,[chunk],controller.signal,()=>{}));assert.equal(calls,scenario==='quota'?1:0);
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});

test('an existing quota lock without an owner is not stolen',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-review-lock-'));let calls=0;
 try{
  mkdirSync(join(directory,'usage.json.lock'));
  const reviewer=createLyricsReviewer({directory,credentials:()=>({account:'a'.repeat(32),token:'secret'}),fetch:async()=>{calls++;throw Error('must not call');}});
  await assert.rejects(reviewer.review(reference,[chunk],new AbortController().signal,()=>{}),/另一个/);assert.equal(calls,0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

// Quota reset is 00:00 UTC / 08:00 Beijing; settlement must retain its reservation day.
test('a response crossing the daily reset cannot deduct previous-day reservation from new usage',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-midnight-')),account='a'.repeat(32);
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T23:59:59Z')});
 let calls=0;
 try{
  const reviewer=createLyricsReviewer({directory,credentials:()=>({account,token:'test'}),fetch:async()=>{
   if(++calls===1){
    const stored=JSON.parse(readFileSync(join(directory,'usage.json'),'utf8'));
    stored.date='2026-10-23';for(const key of Object.keys(stored.neurons))stored.neurons[key]=500;
    t.mock.timers.setTime(new Date('2026-10-23T00:00:01Z').getTime());writeFileSync(join(directory,'usage.json'),JSON.stringify(stored));
   }
   return Response.json({success:true,result:{response:mapping(),usage:{neurons:10}}});
  }});
  await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});
  assert.equal(Object.values(JSON.parse(readFileSync(join(directory,'usage.json'),'utf8')).neurons)[0],520);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('clock rollback and damaged quota records block network calls instead of resetting usage',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-clock-'));t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-23T00:00:00Z')});let calls=0;
 try{
  const reviewer=createLyricsReviewer({directory,credentials:()=>({account:'a'.repeat(32),token:'test'}),fetch:async()=>{calls++;return Response.json({success:true,result:{response:mapping(),usage:{neurons:10}}});}});
  for(const data of [{version:1,date:'2026-10-24',neurons:{}},{version:1,date:'invalid',neurons:{}},{version:1,date:'2026-10-23',neurons:[]}]){
   writeFileSync(join(directory,'usage.json'),JSON.stringify(data));await assert.rejects(reviewer.review(reference,[chunk],new AbortController().signal,()=>{}));
  }assert.equal(calls,0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('timeout retains its reservation; retry reuses the completed first round and only settles new requests',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-timeout-'));let calls=0;
 try{
  const reviewer=createLyricsReviewer({directory,credentials:()=>({account:'a'.repeat(32),token:'test'}),fetch:async()=>{
   if(++calls===2)throw Error('timeout');return Response.json({success:true,result:{response:mapping(),usage:{neurons:10}}});
  }});
  const usage=()=>Object.values(JSON.parse(readFileSync(join(directory,'usage.json'),'utf8')).neurons)[0] as number;
  await assert.rejects(reviewer.review(reference,[chunk],new AbortController().signal,()=>{}),/超时/);const reserved=usage();assert.ok(reserved>10);
  await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});assert.equal(calls,3);assert.equal(usage(),reserved+10);
  await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});assert.equal(calls,3);assert.equal(usage(),reserved+10);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('separate workspaces settle against one account counter without losing either receipt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'lyrics-shared-quota-'));let calls=0;
 try{
  const open=(name:string)=>createLyricsReviewer({directory:join(root,name),usageFile:join(root,'usage.json'),credentials:()=>({account:'a'.repeat(32),token:'test'}),fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json({success:true,result:{response:mapping(),usage:{neurons:10}}});}});
  await Promise.all([open('one'),open('two')].map(reviewer=>reviewer.review(reference,[chunk],new AbortController().signal,()=>{})));
  assert.equal(calls,4);assert.equal(Object.values(JSON.parse(readFileSync(join(root,'usage.json'),'utf8')).neurons)[0],40);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('OpenAI chat uses two rounds and its own cache, without charging the Cloudflare allowance',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-openai-'));let calls=0;
 try{
  const reviewer=createLyricsReviewer({directory,dailyLimit:0,credentials:()=>({provider:'openai' as const,baseURL:'http://localhost:30036/v1',model:'modelscope/Qwen3.8-27B',token:'private-test-token'}),fetch:async(url,init)=>{
   calls++;assert.equal(String(url),'http://localhost:30036/v1/chat/completions');
   const body=JSON.parse(String(init?.body));assert.equal(body.model,'modelscope/Qwen3.8-27B');assert.ok(body.max_tokens);assert.equal(body.messages.length,calls===1?2:4);
   return Response.json({choices:[{message:{content:mapping()},finish_reason:'stop'}]});
  }});
  const result=await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});
  assert.equal(result.summary.model,'modelscope/Qwen3.8-27B');assert.equal(result.chunks[0].parts[1],'野餐垫鼓起一面帆');
  await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});assert.equal(calls,2);
  assert.throws(()=>readFileSync(join(directory,'usage.json')),{code:'ENOENT'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('OpenAI errors, incomplete JSON and truncated responses fail without applying lyrics or switching provider',async()=>{
 for(const response of [new Response('{}',{status:429}),Response.json({choices:[{message:{content:mapping()},finish_reason:'length'}]}),Response.json({choices:[{message:{content:'{}'},finish_reason:'stop'}]})]){
  const directory=mkdtempSync(join(tmpdir(),'lyrics-openai-error-'));let calls=0;
  try{
   const reviewer=createLyricsReviewer({directory,credentials:()=>({provider:'openai' as const,baseURL:'http://localhost:30036/v1',model:'test-model',token:'test'}),fetch:async()=>{calls++;return response;}});
   await assert.rejects(reviewer.review(reference,[chunk],new AbortController().signal,()=>{}),/旧歌词已保留/);assert.equal(calls,1);
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});

 test('explicit OpenAI configuration normalizes the root URL, permits environment overrides and rejects incomplete configuration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-config-')),file=join(directory,'lyrics-review.env');
 try{
  writeFileSync(file,'LYRICS_REVIEW_BASE_URL=http://localhost:30036/\nLYRICS_REVIEW_API_KEY=test-secret\nLYRICS_REVIEW_MODEL=file-model\n');
  assert.deepEqual(lyricsReviewCredentials(file,{LYRICS_REVIEW_MODEL:'env-model'}),{provider:'openai',baseURL:'http://localhost:30036/v1',model:'env-model',token:'test-secret'});
  for(const base of ['http://localhost:30036/v1/','http://localhost:30036/v1'])assert.equal((lyricsReviewCredentials(file,{LYRICS_REVIEW_BASE_URL:base}) as {baseURL:string}).baseURL,'http://localhost:30036/v1');
  for(const base of ['file:///tmp/test','http://user:password@localhost','http://localhost/?key=secret','invalid'])assert.throws(()=>lyricsReviewCredentials(file,{LYRICS_REVIEW_BASE_URL:base}),/地址无效/);
  writeFileSync(file,'LYRICS_REVIEW_MODEL=only-model');assert.throws(()=>lyricsReviewCredentials(file,{}),/完整配置/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('different OpenAI servers and models cannot reuse each other’s cached mapping',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-cache-isolation-'));let calls=0;
 try{
  for(const [baseURL,model,middle] of [['http://localhost:30036/v1','first',1],['http://localhost:30037/v1','first',2],['http://localhost:30037/v1','second',1]] as const){
   const reviewer=createLyricsReviewer({directory,credentials:()=>({provider:'openai' as const,baseURL,model,token:'test'}),fetch:async()=>{calls++;return Response.json({choices:[{message:{content:mapping(middle)},finish_reason:'stop'}]});}});
   const result=await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});
   assert.equal(result.chunks[0].parts[1],middle===1?'野餐垫鼓起一面帆':'你追着帽子跑一圈');
  }
  assert.equal(calls,6);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('Cloudflare allowance exhaustion switches the entire review to the configured backup and reports its model',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lyrics-fallback-'));let calls=0;
 try{
  const reviewer=createLyricsReviewer({directory,dailyLimit:0,credentials:()=>({account:'a'.repeat(32),token:'cf'}),fallbackCredentials:()=>({provider:'openai' as const,baseURL:'http://localhost/v1',model:'backup',token:'backup-token'}),fetch:async(url)=>{
   assert.equal(String(url),'http://localhost/v1/chat/completions');calls++;return Response.json({choices:[{message:{content:mapping()},finish_reason:'stop'}]});
  }});
  const result=await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});
  assert.equal(result.summary.model,'backup');assert.equal(calls,2);assert.equal(result.chunks[0].parts[1],'野餐垫鼓起一面帆');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('Cloudflare is preferred; only quota errors trigger backup, including an exhausted second round',async()=>{
 for(const scenario of ['success','quota-second','network','invalid'] as const){
  const directory=mkdtempSync(join(tmpdir(),'lyrics-fallback-policy-'));let primary=0,backup=0;
  try{
   const reviewer=createLyricsReviewer({directory,credentials:()=>({account:'a'.repeat(32),token:'cf'}),fallbackCredentials:()=>({provider:'openai' as const,baseURL:'http://localhost/v1',model:'backup',token:'test'}),fetch:async(url)=>{
    if(String(url).startsWith('http://localhost')){backup++;return Response.json({choices:[{message:{content:mapping()},finish_reason:'stop'}]});}
    primary++;
    if(scenario==='network')throw Error('connection lost');
    if(scenario==='quota-second'&&primary===2)return new Response('{}',{status:429});
    return Response.json({success:true,result:{response:scenario==='invalid'?'{}':mapping(),usage:{neurons:10}}});
   }});
   if(scenario==='network'||scenario==='invalid'){await assert.rejects(reviewer.review(reference,[chunk],new AbortController().signal,()=>{}));assert.equal(backup,0);}
   else{const result=await reviewer.review(reference,[chunk],new AbortController().signal,()=>{});assert.equal(primary,2);assert.equal(backup,scenario==='success'?0:2);assert.equal(result.summary.model,scenario==='success'?'@cf/qwen/qwen3.8-27b':'backup');}
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
