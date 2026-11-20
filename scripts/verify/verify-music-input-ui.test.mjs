import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

test('music controls keep style, lyrics, structure, seed and ABC distinct and check model capacity before submitting',async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"music-input-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();t.after(async()=>{await browser.close();await server.close();});
 const errors=[],requests=[],checks=[];page.on('pageerror',e=>errors.push(e.message));let overflow=false;
 const state={projects:[{id:'p',title:'容量与创作设置'}],sounds:[{id:'s',projectId:'p',title:'音乐',kind:'music'}],versions:[],voices:[],engines:{speech:{logs:[]},music:{logs:[],canGenerate:true}}};
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1),input=route.request().postDataJSON();
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});
  if(name==='yue2_inspect_input'){checks.push(input);return route.fulfill({json:{context:{prefixTokens:1357,requiredTokens:14455,contextTokens:24576,...(overflow?{issue:'创作内容超过模型上下文容量，请缩短乐谱。'}:{})}}});}
  if(name==='studio_generate'){requests.push(input);const version={id:'v'+requests.length,soundId:'s',number:requests.length,state:'succeeded',stage:'完成',input,source:{kind:'music',id:'a'.repeat(32)},kept:false,deleted:false};state.versions.push(version);return route.fulfill({json:version});}
  if(name==='yue2_score')return route.fulfill({json:{abc:'X:1\nM:4/4\nL:1/4\nK:C\nC D E F|'}});
  return route.fulfill({json:state});
 });
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedBrief=text;}}});});
 await page.goto(server.resolvedUrls.local[0]);await page.click('[data-action="compose"]');
 assert.equal(await page.locator('#compose-form [data-action="agent"]').count(),1,'The main music form offers AI composition with YuE2');
 await page.fill('#creation-text','温暖的吉他，旋律逐段变奏');await page.selectOption('#music-duration','240');await page.click('#compose-form [data-action="agent"]');
 const brief=await page.evaluate(()=>window.copiedBrief);assert.match(brief,/YuE2/);assert.match(brief,/ABC/);assert.match(brief,/"targetDuration": 240/);assert.match(brief,/温暖的吉他，旋律逐段变奏/);assert.match(brief,/不强制.*短样/);assert.doesNotMatch(brief,/studio_import_score/);assert.equal(requests.length,0);assert.ok(await page.locator('#compose-form').isVisible());
 await page.fill('#creation-text','');
 assert.equal(await page.locator('#creation-text').getAttribute('maxlength'),'100000');
 await page.locator('.music-style-guide summary').click();await page.selectOption('#music-style-example','4');await page.click('#fill-style-example');assert.ok((await page.inputValue('#creation-text')).length>30);assert.equal(await page.inputValue('#lyrics'),'');
 await page.fill('#creation-text','x'.repeat(3937));await page.getByRole('radio',{name:'带歌词（演唱）',exact:true}).check();await page.fill('#lyrics','\n[Verse]\n晚风吹过窗边');
 await page.locator('.music-control-options > summary').click();await page.fill('#music-seed','0');
 await page.getByRole('radio',{name:'不带歌词（纯音乐）',exact:true}).check();await page.locator('#structure-wrap summary').click();await page.fill('#music-structure','[Intro]\n[Verse]\n[Chorus]\n[Outro]');
 await page.getByRole('radio',{name:'带歌词（演唱）',exact:true}).check();assert.equal(await page.inputValue('#lyrics'),'\n[Verse]\n晚风吹过窗边');
 await page.click('[data-action="close"]');await page.reload();await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#music-seed'),'0');assert.equal(await page.inputValue('#music-structure'),'[Intro]\n[Verse]\n[Chorus]\n[Outro]');
 await page.locator('#music-abc-settings > summary').click();await page.fill('#music-abc','X:1\nK:C\nC D E F|');
 overflow=true;await page.fill('#music-abc','X:1\nK:C\nC D E F|G A B c|');await page.locator('#music-context-status').filter({hasText:'超过模型上下文'}).waitFor();assert.equal(await page.locator('#creation-text').evaluate(e=>e.validity.valid),false);await page.click('#generate');await page.waitForTimeout(600);assert.equal(requests.length,0);
 overflow=false;await page.fill('#music-abc','X:1\nK:C\nC D E F|');await page.locator('#music-context-status').filter({hasText:'14455 / 24576'}).waitFor();
 await mkdir('test-results/music-input',{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#music-seed').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/music-input/form-${width}.png`});}
 await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(requests.length,1);assert.equal(requests[0].seed,0);assert.equal(requests[0].text.length,3937);assert.equal(requests[0].lyrics,'\n[Verse]\n晚风吹过窗边');assert.equal(requests[0].abc,'X:1\nK:C\nC D E F|');
 await page.click('[data-action="iterate"]');assert.equal(await page.inputValue('#music-seed'),'0');await page.fill('#music-abc','');await page.click('#load-music-score');await page.waitForFunction(()=>document.querySelector('#music-abc').value.includes('M:4/4'));assert.match(await page.inputValue('#music-abc'),/M:4\/4/);
 await page.fill('#music-seed','');await page.getByRole('radio',{name:'不带歌词（纯音乐）',exact:true}).check();await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(requests.length,2);assert.equal(requests[1].seed,undefined);assert.equal(requests[1].lyrics,'[instrumental]');assert.match(checks.at(-1).lyrics,/\[Chorus\]/);await page.click('[data-action="tools"]');assert.ok(await page.locator('.music-agent-entry').isVisible());assert.equal(await page.locator('[data-action="import"]').isVisible(),false);await page.click('#dialog [data-action="agent"]');const continued=await page.evaluate(()=>window.copiedBrief);assert.match(continued,/"parentId": "v2"/);await page.getByText('MIDI / JSON 导入与编辑工具',{exact:true}).click();assert.ok(await page.locator('[data-action="import"]').isVisible());assert.deepEqual(errors,[]);
});
