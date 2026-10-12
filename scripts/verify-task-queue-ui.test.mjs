import {mkdir} from 'node:fs/promises';
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import {chromium} from 'playwright';
test('global queue survives navigation and dialogs and distinguishes offline from idle',async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"queue-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();let offline=false,status={active:{id:'job',engine:'conversion',stage:'running'},queued:[{id:'next',engine:'tts',stage:'queued'}],paused:false};const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{if(r.request().url().endsWith('/resource_status')){if(offline)return r.abort();return r.fulfill({json:status});}return r.fulfill({json:{projects:[{id:'p',title:'项目'}],sounds:[{id:'s',projectId:'p',title:'片段',kind:'conversion'}],versions:[],backgroundVersions:[{id:'job',soundId:'s',number:1,state:'running',stage:'转换第 3 / 11 段'}],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[]},conversion:{}}}});});
 try{await page.goto(server.resolvedUrls.local[0]);await page.locator('#global-task-queue').getByText('正在处理 1 项 · 排队 1 项').waitFor();await page.click('#global-task-queue summary');await page.getByText('转换第 3 / 11 段',{exact:true}).waitFor();await mkdir('test-results/task-queue',{recursive:true});await page.screenshot({path:'test-results/task-queue/desktop.png'});await page.click('[data-action="voice-library"]');await page.locator('#global-task-queue').getByText('正在处理 1 项 · 排队 1 项').waitFor();await page.click('[data-action="new-voice"]');await page.locator('#dialog [data-task-queue]').getByText('正在处理 1 项 · 排队 1 项').waitFor();await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#dialog [data-task-queue]').evaluate(e=>{const r=e.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;}));await page.click('[data-action="close"]');offline=true;await page.getByText('后台连接中断 · 队列状态未知',{exact:true}).first().waitFor();offline=false;status={queued:[],paused:false};await page.locator('#global-task-queue').getByText('后台空闲 · 无排队任务').waitFor();assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
test('lyrics progress updates across navigation and dialogs without rebuilding the workspace',async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"lyrics-queue-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let percent=35,finished=false;
 const active={id:'lyrics-v9',engine:'lyrics',stage:'running',submittedAt:Date.now()},queued={id:'lyrics-v8',engine:'lyrics',stage:'queued',submittedAt:Date.now()};
 await page.route('**/api/**',async r=>{
  if(r.request().url().endsWith('/resource_status'))return r.fulfill({json:{active:finished?undefined:active,queued:finished?[]:[queued],paused:false}});
  return r.fulfill({json:{projects:[{id:'p',title:'歌曲项目'}],sounds:[{id:'s',projectId:'p',title:'春风',kind:'music'}],versions:[],backgroundVersions:[],backgroundLyrics:finished?[]:[
   {soundId:'s',number:9,job:{taskId:active.id,versionId:'v9',state:'running',message:percent===35?'正在识别实际演唱段落 · 已完成 3 / 5 段':'正在定位每句起止时间 · 已完成 2 / 5 段',progress:percent,startedAt:Date.now()-65000,updatedAt:Date.now()}},
   {soundId:'s',number:8,job:{taskId:queued.id,versionId:'v8',state:'queued',message:'等待生成同步歌词',progress:0}}
  ],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[]},conversion:{}}}});
 });
 try{
  await page.goto(server.resolvedUrls.local[0]);const queue=page.locator('#global-task-queue');await queue.getByText('正在处理 1 项 · 排队 1 项').waitFor();await queue.locator('summary').click();
  await queue.getByText('歌曲项目 / 春风 · V9 · 同步歌词',{exact:true}).waitFor();assert.equal(await queue.getByRole('progressbar').getAttribute('value'),'35');await queue.getByText('排队中 · 前面还有 1 项',{exact:true}).waitFor();
  await page.locator('#workspace').evaluate(e=>window.retainedWorkspaceChild=e.firstElementChild);percent=74;
  await page.waitForFunction(()=>document.querySelector('#global-task-queue progress')?.value===74);assert.ok(await queue.locator('details').evaluate(e=>e.open));assert.ok(await page.evaluate(()=>retainedWorkspaceChild===document.querySelector('#workspace').firstElementChild));
  await page.click('[data-action="voice-library"]');await queue.getByText('正在定位每句起止时间 · 已完成 2 / 5 段 · 74%',{exact:true}).waitFor();
  await page.click('[data-action="new-voice"]');const dialogQueue=page.locator('#dialog [data-task-queue]');await dialogQueue.locator('summary').click();await dialogQueue.getByRole('progressbar').waitFor();
  await mkdir('test-results/task-queue',{recursive:true});await page.screenshot({path:'test-results/task-queue/lyrics-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/task-queue/lyrics-mobile.png'});
  assert.ok(await dialogQueue.locator('.queue-list').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}));
  await page.click('[data-action="close"]');finished=true;await queue.getByText('后台空闲 · 无排队任务',{exact:true}).waitFor();assert.equal(await queue.getByRole('progressbar').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
