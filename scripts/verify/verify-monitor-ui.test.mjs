import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

test('sidebar memory line stays visible across pages, opens task-page details and pauses sampling in hidden tabs',async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"monitor-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});t.after(async()=>{await browser.close();await server.close();});
 let samples=0,offline=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1);
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false,residents:[],history:[],policy:{reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8}}});
  if(name==='monitor_status'){
   samples++;if(offline)return route.fulfill({status:503,json:{message:'资源采样暂不可用'}});
   return route.fulfill({json:{sampledAt:Date.now(),cpuCount:8,resources:{policy:{reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8},hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure:'normal',memory:{compressed:8*2**30,swapUsed:2**30},pools:[{id:'memory',capacity:64*2**30,available:32*2**30,owned:2*2**30}]}},system:{cpuPercent:samples===1?undefined:62.5,memoryUsed:24*2**30,memoryTotal:64*2**30},application:{cpuPercent:samples===1?undefined:37.5,memoryBytes:12*2**30,processCount:4,memoryKind:'footprint'}}});
  }
  return route.fulfill({json:{projects:[{id:'p',title:'项目'}],sounds:[],versions:[],voices:[],engines:{speech:{logs:[],message:'测试语音'},music:{logs:[],message:'测试音乐'},conversion:{message:'测试转换'}}}});
 });
 await page.addInitScript(()=>localStorage.setItem('music-room-studio:monitor-test',JSON.stringify({workspaceView:'monitor'})));
 await page.clock.install();
 await page.goto(server.resolvedUrls.local[0]);await page.locator('.sidebar #machine-monitor').waitFor();
 assert.equal(await page.locator('[data-action="monitor"]').count(),0);
 assert.equal(await page.getByRole('heading',{name:'监控',exact:true}).count(),0);
 assert.equal(await page.getByText('保存在本机',{exact:true}).count(),0);
 const line=page.locator('.sidebar #machine-monitor');await line.filter({hasText:'内存 正常 · 可用约 31.0 GiB'}).waitFor();
 assert.equal(await page.locator('.sidebar table').count(),0,'the sidebar shows one line, not CPU tables');assert.equal(await line.locator('.monitor-meter i').count(),5);
 const layout=await page.locator('.sidebar').evaluate(el=>{const rect=s=>{const r=el.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};return {nav:rect('.sidebar-libraries'),monitor:rect('#machine-monitor'),settings:rect('[data-action="settings"]')};});
 assert.ok(layout.nav.top<450,'global navigation stays near the projects while memory stays at the bottom');assert.equal(await page.locator('.sidebar-libraries .library-entry').first().evaluate(el=>getComputedStyle(el).fontSize),'14px');assert.ok(layout.nav.bottom<=layout.monitor.top);assert.ok(layout.monitor.bottom<=layout.settings.top);assert.ok(900-layout.settings.bottom<35);assert.ok(layout.monitor.height<60,'compact sidebar memory line');
 await mkdir('test-results/monitor',{recursive:true});
 for(const theme of ['light','dark']){await page.locator(`[data-theme-choice="${theme}"]`).first().click();await page.screenshot({path:`test-results/monitor/sidebar-${theme}-desktop.png`,fullPage:true});}
 await line.click();await page.getByRole('heading',{name:'任务与资源',exact:true}).waitFor();const overview=page.locator('#resource-status');await page.clock.fastForward(10000);
 await overview.locator('.resource-details summary').click();await overview.getByText('62.5%',{exact:true}).waitFor();await overview.getByText('37.5%',{exact:true}).waitFor();await overview.getByText('12.0 GiB',{exact:true}).waitFor();await overview.locator('.monitor-details').getByText('64.0 GiB',{exact:true}).waitFor();assert.equal(await overview.locator('.monitor-details dt').count(),4);
 await page.clock.fastForward(10000);await page.waitForTimeout(100);assert.equal(await overview.locator('.resource-details').evaluate(el=>el.open),true,'details stay open across refreshes');await page.locator('#task-resources').screenshot({path:'test-results/monitor/task-page-details.png'});
 const before=samples;await page.clock.fastForward(10000);await page.waitForTimeout(100);assert.ok(samples>before,'monitor keeps sampling on other pages');
 assert.equal(await page.getByText('统计说明',{exact:true}).count(),0);
 // Same CSS viewport as 1440×912 at 200% browser zoom. The fixed transport
 // spans the sidebar here, so scrolling must expose Settings above it.
 await page.setViewportSize({width:720,height:456});await page.locator('.sidebar [data-action="settings"]').click();await page.locator('#settings-page').waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/monitor/sidebar-mobile.png',fullPage:true});
 await page.reload();await line.filter({hasText:'可用约 31.0 GiB'}).waitFor();
 offline=true;await page.clock.fastForward(10000);await line.filter({hasText:'暂时无法读取内存'}).waitFor();assert.equal(await line.getAttribute('data-state'),'error');
 offline=false;await page.clock.fastForward(10000);await line.filter({hasText:'可用约 31.0 GiB'}).waitFor();
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));const hiddenSamples=samples;await page.clock.fastForward(10000);await page.waitForTimeout(100);assert.equal(samples,hiddenSamples);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(10000);await page.waitForTimeout(100);assert.ok(samples>hiddenSamples);assert.deepEqual(errors,[]);
});
