import {encodeWav} from '../../src/wav.ts';
import {mkdir} from 'node:fs/promises';
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import {chromium} from 'playwright';
test('sidebar live status survives navigation and dialogs; the task page keeps only history and resources through reconnects',async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"queue-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 const queued=Array.from({length:52},(_,i)=>({id:`queued-${i}`,engine:'yue2',stage:'queued'}));
 const taskHistory=[
  {id:'job',soundId:'s',number:1,state:'running',stage:'正在生成',createdAt:'2026-11-21T00:00:00Z',hasAudio:false},
  ...queued.map(({id},i)=>({id,soundId:'s',number:i+2,state:'queued',stage:'排队中',createdAt:'2026-11-21T00:00:00Z',hasAudio:false}))
 ];
 let offline=false,status={active:{id:'job',engine:'yue2',stage:'running'},queued,paused:false};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{if(r.request().url().endsWith('/resource_status')){if(offline)return r.abort();return r.fulfill({json:status});}return r.fulfill({json:{projects:[{id:'p',title:'项目'}],sounds:[{id:'s',projectId:'p',title:'片段',kind:'music'}],versions:[],taskHistory,voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[]},conversion:{}}}});});
 try{
  await page.goto(server.resolvedUrls.local[0]);
  const live=page.locator('.sidebar [data-task-live]');
  await live.getByText('1 进行中 · 52 排队',{exact:true}).waitFor();
  assert.equal(await live.getAttribute('data-state'),'working');
  assert.equal(await page.locator('#global-status-bar [data-task-queue]').count(),0);
  await page.click('[data-action="task-list"]');
  const tasks=page.locator('#task-resources'),history=tasks.getByRole('list',{name:'生成历史'});
  await history.getByRole('button',{name:'片段 · V1',exact:true}).waitFor();
  assert.equal(await tasks.getByRole('heading',{name:'进行中与排队',exact:true}).count(),0);
  assert.equal(await tasks.getByRole('heading',{name:'本机资源',exact:true}).isVisible(),true);
  assert.equal(await history.getByRole('listitem').count(),10);
  await tasks.getByRole('button',{name:/^排队中\s*52$/}).click();
  assert.equal(await history.getByRole('listitem').count(),10);
  assert.equal(await history.getByRole('button',{name:'片段 · V1',exact:true}).count(),0);
  await mkdir('test-results/task-queue',{recursive:true});
  await page.screenshot({path:'test-results/task-queue/desktop.png'});
  await page.click('[data-action="voice-library"]');await live.filter({hasText:'1 进行中 · 52 排队'}).waitFor();await page.click('[data-action="new-voice"]');assert.equal(await page.locator('#dialog [data-task-queue]').count(),0);await page.setViewportSize({width:390,height:844});assert.equal(await live.textContent(),'1 进行中 · 52 排队');await page.click('[data-action="close"]');
  offline=true;await live.filter({hasText:'连接中断'}).waitFor();await page.click('[data-action="task-list"]');await tasks.getByText('暂时无法读取电脑资源',{exact:true}).waitFor();assert.equal(await live.locator('..').getAttribute('title'),'后台连接中断 · 队列状态未知');offline=false;status={queued:[],paused:false};await page.waitForFunction(()=>document.querySelector('[data-task-live]')?.textContent==='');assert.equal(await live.locator('..').getAttribute('title'),'后台空闲 · 无排队任务');assert.equal(await live.textContent(),'');assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
test('task page titles open exact versions across projects without interrupting playback',async t=>{
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
  return r.fulfill({json:{projects:[{id:'p1',title:'项目 A'},{id:'p2',title:'项目 B'}],sounds:[{id:'s1',projectId:'p1',title:'播放中',kind:'music'},{id:'s2',projectId:'p2',title:'待生成',kind:'music'}],versions,taskHistory:versions.map(v=>({...v,createdAt:'2026-11-21T00:00:00Z',hasAudio:!!v.audioPath})),lyricTaskHistory:[{...versions[0],taskId:'lyrics',state:'queued',createdAt:'2026-11-21T00:00:00Z',hasAudio:true}],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[],canGenerate:true}}}});
 });
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=2);
 await page.locator('#version-audio').evaluate(async a=>{a.currentTime=10;await a.play();window.originalAudio=a;window.pauseEvents=0;a.addEventListener('pause',()=>window.pauseEvents++);});
 const history=page.getByRole('list',{name:'生成历史'});await page.click('[data-action="task-list"]');
 await history.getByRole('button',{name:'待生成 · V2',exact:true}).click();
 await page.locator('.listening .version-label').getByText('V2',{exact:true}).waitFor();assert.equal(await page.locator('.project-header h1').textContent(),'项目 B');
 assert.equal(await page.evaluate(()=>originalAudio.paused),false);
 await page.locator('[data-action="voice-library"]').click();await page.click('[data-action="task-list"]');
 const queuedTitle=history.getByRole('button',{name:'待生成 · V3',exact:true});await page.locator('[data-task-filter="queued"]').click();await queuedTitle.press('Enter');
 await page.locator('.listening .version-label').getByText('V3',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>originalAudio.paused),false);
 await page.click('[data-action="task-list"]');await history.getByRole('button',{name:'播放中 · V1 · 同步歌词',exact:true}).click();
 await page.locator('.listening .version-label').getByText('V1',{exact:true}).waitFor();assert.equal(await page.locator('.project-header h1').textContent(),'项目 A');
 assert.equal(await page.evaluate(()=>originalAudio===document.querySelector('#version-audio')&&!originalAudio.paused),true);assert.equal(await page.evaluate(()=>pauseEvents),0);assert.deepEqual(errors,[]);
});
