import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

for(const scenario of ['failed-edit','failed-saved-draft','recoverable','successful'])test(`music seed form handles ${scenario}`,async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"seed-reset-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});t.after(async()=>{await browser.close();await server.close();});
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 const input={soundId:'s',text:'flute and harp',instrumental:true,seed:42,targetDuration:180};
 const original={id:'v1',soundId:'s',number:1,state:scenario==='successful'?'succeeded':'failed',stage:'完成',input,source:{kind:'music',id:'a'.repeat(32)},kept:false,deleted:false,...(scenario==='recoverable'?{musicRecovery:{jobId:'a'.repeat(32),stage:'plan'}}:{})};
 const state={projects:[{id:'p',title:'种子验收'}],sounds:[{id:'s',projectId:'p',title:'音乐',kind:'music'}],versions:[original],voices:[],engines:{speech:{logs:[]},music:{logs:[],canGenerate:true}}};
 if(scenario==='failed-saved-draft')await page.addInitScript(input=>{if(!localStorage.getItem('music-room-studio:seed-reset-test'))localStorage.setItem('music-room-studio:seed-reset-test',JSON.stringify({projectId:'p',soundId:'s',versionId:'v1',drafts:{s:input}}));},input);
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1),args=route.request().postDataJSON();
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});
  if(name==='yue2_inspect_input')return route.fulfill({json:{context:{prefixTokens:100,requiredTokens:5000,contextTokens:24576}}});
  if(name==='studio_generate'){requests.push(args);const next={...original,id:'v2',number:2,state:'queued',input:args};state.versions.push(next);return route.fulfill({json:next});}
  return route.fulfill({json:state});
 });
 await page.goto(server.resolvedUrls.local[0]);
 await page.locator(scenario==='failed-saved-draft'?'[data-action="compose"]':'[data-action="iterate"]').first().click();
 const cleared=scenario.startsWith('failed');
 assert.equal(await page.inputValue('#music-seed'),cleared?'':'42');assert.equal(await page.inputValue('#creation-text'),input.text);
 if(cleared){
  assert.equal(await page.locator('#music-seed-reset-note').isVisible(),true);assert.match(await page.locator('#music-seed-reset-note').innerText(),/42.*已自动清空/);
  await page.fill('#music-seed','99');await page.locator('#music-seed').blur();assert.equal(await page.inputValue('#music-seed'),'99');
  await page.fill('#music-seed','43');await page.locator('#music-seed').blur();assert.equal(await page.inputValue('#music-seed'),'');
  await mkdir('test-results/music-seed-reset',{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('.music-control-options').evaluate(e=>e.open=true);await page.locator('#music-seed').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/music-seed-reset/${scenario}-${width}.png`});}
  await page.click('[data-action="close"]');await page.reload();await page.locator('[data-action="compose"]').first().click();assert.equal(await page.inputValue('#music-seed'),'');
 }else assert.equal(await page.locator('#music-seed-reset-note').isVisible(),false);
 await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);
 assert.equal(requests.length,1);assert.equal(requests[0].seed,cleared?undefined:42);assert.equal(requests[0].text,input.text);assert.equal(requests[0].targetDuration,180);assert.equal(original.input.seed,42);assert.deepEqual(errors,[]);
});
