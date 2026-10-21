import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {encodeWav} from '../src/wav.ts';

for(const action of ['retry','delete-selected-failure','delete-unselected-failure','delete-batch-failures'])test(`${action} in the same sound preserves the playing successful version`,async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"retry-delete-playback"}</script></head>')}]});
 await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 const success={id:'playing',soundId:'s',number:15,state:'succeeded',stage:'已完成',createdAt:'2026-10-21',source:{kind:'music',id:'job-ok'},audioPath:'/audio/test.wav',input:{soundId:'s',text:'piano',instrumental:true}};
 const failure={...success,id:'failed',number:17,state:'failed',stage:'生成失败',source:{kind:'music',id:'job-failed'},audioPath:undefined,error:'乐谱写作达到长度上限'};
 const failures=action==='delete-batch-failures'?[failure,{...failure,id:'failed2',number:18},{...failure,id:'failed3',number:19}]:[failure];
 const versions=[success,...failures];
 let rejectAction=true,attempts=0;
 await page.route('**/audio/**',r=>r.fulfill({contentType:'audio/wav',body:Buffer.from(encodeWav([new Float32Array(22050*60)],22050))}));
 await page.route('**/api/**',r=>{
  const name=r.request().url().split('/').pop();
  if(name==='resource_status')return r.fulfill({json:{queued:[],paused:false}});
  if(name==='studio_retry_music'||name==='studio_update_version'){
   attempts++;
   if(rejectAction)return r.fulfill({status:400,json:{message:'模拟请求失败'}});
   if(name==='studio_retry_music'){const next={...failure,id:'retry',number:20,state:'queued',stage:'排队中'};versions.push(next);return r.fulfill({json:next});}
   const removed=failures.find(v=>v.id===r.request().postDataJSON().versionId);assert.ok(removed);removed.deleted=true;return r.fulfill({json:removed});
  }
  if(name==='studio_lyrics')return r.fulfill({json:{lines:[],canGenerate:false}});
  return r.fulfill({json:{projects:[{id:'p',title:'音乐'}],sounds:[{id:'s',projectId:'p',title:'类 stray2',kind:'music'}],versions,voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{canGenerate:true,logs:[]},conversion:{}}}});
 });
 try{
  await page.goto(process.env.MUSIC_PLAYBACK_TEST_URL??server.resolvedUrls.local[0]);
  await page.locator('[data-action="version"][data-id="playing"]').click();
  await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=2);
  await page.locator('#version-audio').evaluate(async a=>{a.currentTime=10;await a.play();window.originalAudio=a;window.pauseEvents=0;a.addEventListener('pause',()=>window.pauseEvents++);});
  if(action!=='delete-unselected-failure')await page.locator('[data-action="version"][data-id="failed"]').click();
  const submit=async()=>{if(action==='retry')await page.locator('[data-action="retry-generation"]').click();else{for(const v of failures)await page.locator(`[data-select-version="${v.id}"]`).check();await page.locator('[data-action="delete-selected"]').click();}};
  await submit();await page.locator('#toast').filter({hasText:'模拟请求失败'}).waitFor();
  assert.equal(await page.evaluate(()=>originalAudio.paused),false,'failed request preserves playback');
  rejectAction=false;await submit();
  await page.locator('#toast').filter({hasText:action==='retry'?'已创建 V20':'已移入回收站'}).waitFor();
  assert.equal(attempts,action==='retry'?2:failures.length*2);
  assert.equal(await page.evaluate(()=>originalAudio.isConnected),true,'keep the same player connected');
  assert.equal(await page.evaluate(()=>originalAudio.paused),false,'successful action preserves playback');
  assert.ok(await page.evaluate(()=>originalAudio.currentTime>=10),'keep playback position');
  assert.equal(await page.evaluate(()=>pauseEvents),0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
