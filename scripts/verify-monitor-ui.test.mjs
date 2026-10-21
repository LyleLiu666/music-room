import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

test('monitor separates machine and app usage, handles unavailable data, stops when left and keeps navigation compact',async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"monitor-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});t.after(async()=>{await browser.close();await server.close();});
 let samples=0,offline=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1);
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});
  if(name==='monitor_status'){
   samples++;if(offline)return route.fulfill({status:503,json:{message:'资源采样暂不可用'}});
   return route.fulfill({json:{sampledAt:Date.now(),cpuCount:8,system:{cpuPercent:samples===1?undefined:62.5,memoryUsed:24*2**30,memoryTotal:64*2**30},application:{cpuPercent:samples===1?undefined:37.5,memoryBytes:12*2**30,processCount:4,memoryKind:'footprint'}}});
  }
  return route.fulfill({json:{projects:[{id:'p',title:'项目'}],sounds:[],versions:[],voices:[],engines:{speech:{logs:[]},music:{logs:[]}}}});
 });
 await page.goto(server.resolvedUrls.local[0]);await page.locator('[data-action="monitor"]').waitFor();assert.equal(samples,0);
 assert.equal(await page.getByText('保存在本机',{exact:true}).count(),0);
 const nav=await page.locator('.sidebar').evaluate(el=>['sound-library','monitor','settings'].map(action=>{const r=el.querySelector(`[data-action="${action}"]`).getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
 assert.ok(nav[0].bottom<=nav[1].top);assert.ok(nav[1].bottom<=nav[2].top);assert.ok(900-nav[2].bottom<35,'settings sits at sidebar bottom');assert.ok(nav[2].top-nav[1].bottom<30,'no empty spacer between monitoring and settings');
 await page.getByRole('button',{name:'监控',exact:true}).click();await page.getByRole('heading',{name:'监控',exact:true}).waitFor();
 await page.getByText('12.0 GB',{exact:true}).waitFor();assert.ok(await page.getByText('采样中…',{exact:true}).count()>0);
 await page.getByText('62.5%',{exact:true}).waitFor();await page.getByText('37.5%',{exact:true}).waitFor();assert.equal(await page.locator('[data-action="monitor"]').getAttribute('aria-current'),'page');
 await mkdir('test-results/monitor',{recursive:true});
 for(const theme of ['light','dark']){await page.locator(`[data-theme-choice="${theme}"]`).first().click();await page.screenshot({path:`test-results/monitor/${theme}-desktop.png`,fullPage:true});}
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/monitor/mobile.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'监控',exact:true}).waitFor();await page.getByText('12.0 GB',{exact:true}).waitFor();
 offline=true;await page.getByText('资源采样暂不可用',{exact:true}).waitFor();assert.equal(await page.getByText('12.0 GB',{exact:true}).count(),0);
 offline=false;await page.getByText('12.0 GB',{exact:true}).waitFor();
 await page.getByRole('button',{name:'任务列表',exact:true}).click();await page.getByRole('heading',{name:'任务列表',exact:true}).waitFor();const before=samples;await page.waitForTimeout(2300);assert.equal(samples,before);assert.deepEqual(errors,[]);
});
