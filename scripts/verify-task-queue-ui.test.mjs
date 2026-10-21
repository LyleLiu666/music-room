import {encodeWav} from '../src/wav.ts';
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

test('queue titles open exact versions across projects and dialogs without interrupting playback',async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"queue-links"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});t.after(async()=>{await browser.close();await server.close();});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const versions=[{id:'v1',soundId:'s1',number:1,state:'succeeded',stage:'已完成',audioPath:'/audio/test.wav',source:{kind:'music',id:'song'},input:{soundId:'s1',text:'piano',instrumental:true}},
 {id:'v2',soundId:'s2',number:2,state:'running',stage:'正在生成',source:{kind:'music',id:'job2'},input:{soundId:'s2',text:'strings',instrumental:true}},
 {id:'v3',soundId:'s2',number:3,state:'queued',stage:'排队中',source:{kind:'music',id:'job3'},input:{soundId:'s2',text:'flute',instrumental:true}}];
 const status={active:{id:'job2',engine:'yue2',stage:'running'},queued:[{id:'job3',engine:'yue2',stage:'queued'},{id:'lyrics',engine:'lyrics',stage:'queued'}],paused:false};
 await page.route('**/audio/**',r=>r.fulfill({contentType:'audio/wav',body:Buffer.from(encodeWav([new Float32Array(22050*60)],22050))}));
 await page.route('**/api/**',r=>{
  const name=r.request().url().split('/').at(-1);
  if(name==='resource_status')return r.fulfill({json:status});
  if(name==='studio_lyrics')return r.fulfill({json:{lines:[],canGenerate:false}});
  return r.fulfill({json:{projects:[{id:'p1',title:'项目 A'},{id:'p2',title:'项目 B'}],sounds:[{id:'s1',projectId:'p1',title:'播放中',kind:'music'},{id:'s2',projectId:'p2',title:'待生成',kind:'music'}],versions,backgroundVersions:versions.slice(1),backgroundLyrics:[{soundId:'s1',number:1,job:{taskId:'lyrics',versionId:'v1',state:'queued'}}],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[],canGenerate:true}}}});
 });
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=2);
 await page.locator('#version-audio').evaluate(async a=>{a.currentTime=10;await a.play();window.originalAudio=a;window.pauseEvents=0;a.addEventListener('pause',()=>window.pauseEvents++);});
 const queue=page.locator('#global-task-queue');await queue.locator('summary').click();
 await queue.getByRole('button',{name:'项目 B / 待生成 · V2',exact:true}).click();
 await page.locator('.listening .version-label').getByText('V2',{exact:true}).waitFor();assert.equal(await page.locator('.project-header h1').textContent(),'项目 B');assert.equal(await queue.locator('details').evaluate(e=>e.open),false);
 assert.equal(await page.evaluate(()=>originalAudio.paused),false);
 await page.locator('[data-action="voice-library"]').click();await page.locator('[data-action="new-voice"]').click();
 const dialogQueue=page.locator('#dialog [data-task-queue]');await dialogQueue.locator('summary').click();
 const queuedTitle=dialogQueue.getByRole('button',{name:'项目 B / 待生成 · V3',exact:true});await queuedTitle.focus();status.queued[0].message='等待下一轮处理';
 await dialogQueue.getByText('等待下一轮处理 · 前面还有 1 项',{exact:true}).waitFor();assert.equal(await queuedTitle.evaluate(e=>e===document.activeElement),true);await queuedTitle.press('Enter');
 await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('.listening .version-label').getByText('V3',{exact:true}).waitFor();assert.equal(await queue.locator('details').evaluate(e=>e.open),false);assert.equal(await page.evaluate(()=>originalAudio.paused),false);
 await queue.locator('summary').click();await queue.getByRole('button',{name:'项目 A / 播放中 · V1 · 同步歌词',exact:true}).click();
 await page.locator('.listening .version-label').getByText('V1',{exact:true}).waitFor();assert.equal(await page.locator('.project-header h1').textContent(),'项目 A');
 assert.equal(await page.evaluate(()=>originalAudio===document.querySelector('#version-audio')&&!originalAudio.paused),true);assert.equal(await page.evaluate(()=>pauseEvents),0);assert.deepEqual(errors,[]);
});
