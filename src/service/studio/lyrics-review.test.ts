import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLyricsReviewer,parseLyricMapping,applyReviewedMapping,type TranscriptChunk} from './lyrics-review.ts';

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
