import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import {chromium} from 'playwright';import {encodeWav} from '../src/wav.ts';
for(const mode of ['native','rejected','missing'])test(`playing music permits page navigation (DOM move: ${mode})`,async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"compose-playback"}</script></head>')}]});await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();if(mode!=='native')await page.addInitScript(mode=>{Element.prototype.moveBefore=mode==='missing'?undefined:function(){throw new DOMException('State-preserving move unavailable','NotSupportedError');};},mode);let samples=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const original={id:'v1',soundId:'s',number:1,state:'succeeded',stage:'已完成',createdAt:'2026-10-20',source:{kind:'music',id:'job'},audioPath:'/audio/test.wav',input:{soundId:'s',text:'piano',instrumental:true}};
 await page.route('**/audio/**',r=>r.fulfill({contentType:'audio/wav',body:Buffer.from(encodeWav([new Float32Array(22050*60)],22050))}));
 await page.route('**/api/**',r=>{const name=r.request().url().split('/').pop();if(name==='monitor_status'){samples++;return r.fulfill({json:{sampledAt:Date.now(),system:{cpuPercent:20,memoryUsed:8*2**30,memoryTotal:32*2**30},application:{cpuPercent:10,memoryBytes:2*2**30,memoryKind:'footprint'}}});}if(name==='resource_status')return r.fulfill({json:{queued:[],paused:false}});if(name==='studio_lyrics')return r.fulfill({json:{lines:[],canGenerate:false}});return r.fulfill({json:{projects:[{id:'p',title:'音乐'}],sounds:[{id:'s',projectId:'p',title:'钢琴',kind:'music'}],versions:[original],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{canGenerate:true,logs:[]},conversion:{}}}});});
 try{page.setDefaultTimeout(5000);await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=2);await page.locator('#version-audio').evaluate(async a=>{a.currentTime=10;await a.play();window.originalAudio=a;window.pauseEvents=0;a.addEventListener('pause',()=>window.pauseEvents++);});
 for(let round=0;round<2;round++){
  await page.locator('[data-action="task-list"]').click();await page.getByRole('heading',{name:'任务列表',exact:true}).waitFor();
  await page.locator('[data-action="voice-library"]').click();await page.locator('#workspace').getByRole('heading',{name:'音色库',exact:true}).waitFor();
  await page.locator('[data-action="sound-library"]').click();await page.locator('#workspace').getByRole('heading',{name:'声音库',exact:true}).waitFor();
  await page.locator('.sidebar #machine-monitor').waitFor();assert.equal(await page.locator('[data-action="monitor"]').count(),0);
  await page.locator('[data-action="project"][data-id="p"]').click();await page.locator('#version-audio').waitFor();
  assert.equal(await page.evaluate(()=>originalAudio.paused),false);assert.equal(await page.evaluate(()=>originalAudio===document.querySelector('#version-audio')),true);
 }
 await page.waitForTimeout(2300);assert.ok(samples>1);assert.equal(await page.evaluate(()=>originalAudio.paused),false);assert.ok(await page.evaluate(()=>originalAudio.currentTime>=10));if(mode==='native')assert.equal(await page.evaluate(()=>pauseEvents),0);assert.deepEqual(errors,[]);

 }finally{await browser.close();await server.close();}
});
