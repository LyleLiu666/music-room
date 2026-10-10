import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {encodeWav} from '../src/wav.ts';

test('conversion uploads full audio, reflects server phases, preserves playback and restores jobs',async()=>{
 const wav=Buffer.from(encodeWav([Float32Array.from({length:24000*8},(_,i)=>Math.sin(i*.1)*.2)],24000));
 const jobs=[];let uploads=0,retries=0,cancels=0;const requestIds=[];
 const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;let bytes=await readFile(resolve('dist',path.slice(1)||'conversion.html'));if(path.endsWith('.html')||path==='/')bytes=Buffer.from(bytes.toString().replace('</head>','<script id="music-room-service" type="application/json">{"token":"test-token","url":"/","workspace":"test"}</script></head>'));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'text/html');res.end(bytes);}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();assert.equal(route.request().headers().authorization,'Bearer test-token');let value={};if(name==='svc_library')value={status:{ready:true,message:'可以开始转换'},jobs,voices:[{id:'voice-ready',name:'龚琳娜',usage:'conversion'},{id:'voice-busy',name:'正在清理',processing:{state:'running'}},{id:'voice-deleted',name:'已删除',deleted:true}]};if(name==='tts_library')value={voices:[]};if(name==='svc_cancel'){cancels++;Object.assign(jobs[0],{state:'cancelled',stage:'已取消',progress:.4});}if(name==='svc_retry'){retries++;jobs[0].state='queued';jobs[0].error=undefined;}await route.fulfill({json:value});});
 await page.route('**/conversion/upload?*',async route=>{uploads++;requestIds.push(new URL(route.request().url()).searchParams.get('requestId'));assert.deepEqual(route.request().postDataBuffer(),wav);assert.equal(new URL(route.request().url()).searchParams.get('voiceId'),'voice-ready');if(!jobs.length)jobs.unshift({id:'job-1',name:'完整歌曲.wav',voiceId:'voice-ready',voiceName:'龚琳娜',state:'queued',phase:'preparing',stage:'等待开始',progress:0,createdAt:new Date().toISOString()});if(uploads===1)await route.fulfill({status:503,json:{message:'上传已保存但响应中断'}});else await route.fulfill({json:jobs[0]});});
 await page.route('**/conversion/audio/**',route=>route.fulfill({contentType:'audio/wav',body:wav}));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/conversion.html`);
  await page.getByLabel('目标音色').selectOption('voice-ready');assert.equal(await page.getByRole('option').count(),2);
  await page.getByLabel('原始音频').setInputFiles({name:'完整歌曲.wav',mimeType:'audio/wav',buffer:wav});await page.getByRole('button',{name:'开始转换',exact:true}).click();await page.getByText('上传已保存但响应中断',{exact:true}).waitFor();await page.getByRole('button',{name:'开始转换',exact:true}).click();await page.getByText('等待开始',{exact:true}).waitFor();assert.equal(uploads,2);assert.equal(requestIds[0],requestIds[1]);
  for(const [phase,stage,progress] of [['separation','正在提取人声',.12],['conversion','转换第 2 / 8 段',.45],['mixing','合并原背景音',.95]]){Object.assign(jobs[0],{state:'running',phase,stage,progress});await page.getByText(stage,{exact:true}).waitFor();assert.equal(await page.locator('progress').getAttribute('value'),String(progress));}
  Object.assign(jobs[0],{state:'succeeded',phase:'complete',stage:'转换完成',progress:1});await page.getByRole('button',{name:'试听转换结果',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);await page.locator('audio').evaluate(a=>{a.dataset.probe='preserve';return a.play();});await page.waitForTimeout(2200);assert.equal(await page.locator('audio').getAttribute('data-probe'),'preserve');assert.ok(await page.locator('audio').evaluate(a=>a.currentTime)>1);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载转换结果',exact:true}).click();assert.match((await downloading).suggestedFilename(),/\.wav$/);
  await page.reload();await page.getByRole('button',{name:'试听转换结果',exact:true}).waitFor();assert.equal(uploads,2);
  Object.assign(jobs[0],{state:'failed',error:'测试失败'});await page.getByRole('button',{name:'重试',exact:true}).click();assert.equal(retries,1);await page.getByRole('button',{name:'取消任务',exact:true}).click();assert.equal(cancels,1);
  await mkdir('test-results/conversion',{recursive:true});await page.screenshot({path:'test-results/conversion/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/conversion/mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
