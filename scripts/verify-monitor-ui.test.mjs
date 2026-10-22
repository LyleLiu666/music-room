import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

test('sidebar monitor stays visible across pages, keeps navigation above it and pauses sampling in hidden tabs',async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"monitor-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});t.after(async()=>{await browser.close();await server.close();});
 let samples=0,offline=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1);
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});
  if(name==='monitor_status'){
   samples++;if(offline)return route.fulfill({status:503,json:{message:'资源采样暂不可用'}});
   return route.fulfill({json:{sampledAt:Date.now(),cpuCount:8,resources:{policy:{reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8},hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:64*2**30,available:32*2**30,owned:2*2**30}]}},system:{cpuPercent:samples===1?undefined:62.5,memoryUsed:24*2**30,memoryTotal:64*2**30},application:{cpuPercent:samples===1?undefined:37.5,memoryBytes:12*2**30,processCount:4,memoryKind:'footprint'}}});
  }
  return route.fulfill({json:{projects:[{id:'p',title:'项目'}],sounds:[],versions:[],voices:[],engines:{speech:{logs:[]},music:{logs:[]}}}});
 });
 await page.addInitScript(()=>localStorage.setItem('music-room-studio:monitor-test',JSON.stringify({workspaceView:'monitor'})));
 await page.goto(server.resolvedUrls.local[0]);await page.locator('.sidebar #machine-monitor').waitFor();
 assert.equal(await page.locator('[data-action="monitor"]').count(),0);
 assert.equal(await page.getByRole('heading',{name:'监控',exact:true}).count(),0);
 assert.equal(await page.getByText('保存在本机',{exact:true}).count(),0);
 await page.getByText('12.0 GiB',{exact:true}).waitFor();assert.ok(await page.getByText('采样中',{exact:true}).count()>0);
 await page.getByText('压力正常',{exact:true}).waitFor();await page.getByText('本程序可再用约 31.0 GiB',{exact:true}).waitFor();await page.getByText('62.5%',{exact:true}).waitFor();await page.getByText('37.5%',{exact:true}).waitFor();
 const layout=await page.locator('.sidebar').evaluate(el=>{const rect=s=>{const r=el.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};return {pagination:rect('#project-pagination'),nav:rect('.sidebar-libraries'),monitor:rect('#machine-monitor'),settings:rect('[data-action="settings"]')};});
 assert.ok(layout.monitor.top-layout.nav.bottom<=16,'navigation sits directly above resource monitor');assert.equal(await page.locator('.sidebar-libraries .library-entry').first().evaluate(el=>getComputedStyle(el).fontSize),'16px');assert.ok(layout.nav.bottom<=layout.monitor.top);assert.ok(layout.monitor.bottom<=layout.settings.top);assert.ok(900-layout.settings.bottom<35);assert.ok(layout.monitor.height<150,'compact sidebar resource table');
 await page.locator('.monitor-details summary').click();await page.getByText('非空闲 24.0 GiB / 64.0 GiB（含缓存）',{exact:true}).waitFor();await page.waitForTimeout(2300);assert.equal(await page.locator('.monitor-details').evaluate(el=>el.open),true);await page.locator('.monitor-details summary').click();
 await mkdir('test-results/monitor',{recursive:true});
 for(const theme of ['light','dark']){await page.locator(`[data-theme-choice="${theme}"]`).first().click();await page.screenshot({path:`test-results/monitor/sidebar-${theme}-desktop.png`,fullPage:true});}
 await page.getByRole('button',{name:'任务列表',exact:true}).click();await page.getByRole('heading',{name:'任务列表',exact:true}).waitFor();const before=samples;await page.waitForFunction(()=>document.querySelector('.sidebar #machine-monitor'));await page.waitForTimeout(2300);assert.ok(samples>before,'monitor keeps sampling on other pages');
 assert.equal(await page.getByText('统计说明',{exact:true}).count(),0);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/monitor/sidebar-mobile.png',fullPage:true});
 await page.reload();await page.locator('.sidebar #machine-monitor').waitFor();await page.getByText('12.0 GiB',{exact:true}).waitFor();
 offline=true;await page.getByText('暂不可用',{exact:true}).first().waitFor();assert.equal(await page.getByText('12.0 GiB',{exact:true}).count(),0);
 offline=false;await page.getByText('12.0 GiB',{exact:true}).waitFor();
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));const hiddenSamples=samples;await page.waitForTimeout(2300);assert.equal(samples,hiddenSamples);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(2300);assert.ok(samples>hiddenSamples);assert.deepEqual(errors,[]);
});
