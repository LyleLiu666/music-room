import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
test('target duration survives drafts and iteration for vocal and instrumental music; auto remains optional',async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"duration-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});t.after(async()=>{await browser.close();await server.close();});
 const errors=[],requests=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const state={projects:[{id:'p',title:'时长验收'}],sounds:[{id:'s',projectId:'p',title:'音乐',kind:'music'}],versions:[],voices:[],engines:{speech:{logs:[]},music:{logs:[],canGenerate:true}}};
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1),input=route.request().postDataJSON();
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});
  if(name==='yue2_inspect_input'){checks.push(input);return route.fulfill({json:{context:{prefixTokens:1000,requiredTokens:14000,contextTokens:24576,...(input.abc&&input.targetDuration?{issue:'自定义乐谱预计 60 秒，与目标约 3 分钟不符。'}:{})}}});}
  if(name==='studio_generate'){requests.push(input);const version={id:'v'+requests.length,soundId:'s',number:requests.length,state:'succeeded',stage:'完成',input,source:{kind:'music',id:'a'.repeat(32)},kept:false,deleted:false};state.versions.push(version);return route.fulfill({json:version});}
  return route.fulfill({json:state});
 });
 await page.goto(server.resolvedUrls.local[0]);await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#music-duration'),'');
 await page.selectOption('#music-duration','180');await page.fill('#creation-text','温暖的吉他民谣，80 BPM');await page.getByRole('radio',{name:'带歌词（演唱）',exact:true}).check();const lyrics='[Verse]\n晚风吹过窗边\n[Chorus]\n等你回到身边';await page.fill('#lyrics',lyrics);
 await page.click('[data-action="close"]');await page.reload();await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#music-duration'),'180');assert.equal(await page.inputValue('#lyrics'),lyrics);
 await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(requests[0].targetDuration,180);assert.equal(requests[0].lyrics,lyrics);assert.equal(checks.at(-1).targetDuration,180);
 await page.locator('.listening-actions .more-menu > summary').click();await page.click('[data-action="requirements"]');assert.match(await page.locator('dialog').innerText(),/目标时长：约 3 分钟/);await page.click('[data-action="close"]');
 await page.click('[data-action="iterate"]');assert.equal(await page.inputValue('#music-duration'),'180');await page.getByRole('radio',{name:'不带歌词（纯音乐）',exact:true}).check();await page.selectOption('#music-duration','240');
 await mkdir('test-results/duration-ui',{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('#music-duration').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/duration-ui/form-${width}.png`});}
 await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(requests[1].instrumental,true);assert.equal(requests[1].targetDuration,240);assert.equal(requests[1].lyrics,'[instrumental]');
 await page.click('[data-action="iterate"]');await page.locator('.music-control-options > summary').click();await page.locator('#music-abc-settings > summary').click();await page.fill('#music-abc','existing ABC');await page.locator('#music-context-status').filter({hasText:'自定义乐谱预计'}).waitFor();await page.click('#generate');assert.equal(requests.length,2);
 await page.selectOption('#music-duration','');await page.locator('#music-context-status').filter({hasText:'14000 / 24576'}).waitFor();await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(requests[2].targetDuration,undefined);assert.equal(requests[2].abc,'existing ABC');assert.deepEqual(errors,[]);
});
