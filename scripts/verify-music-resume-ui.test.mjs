import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

for(const reason of ['RESOURCE_TELEMETRY_UNAVAILABLE',undefined])test(`failed music resumes its saved stage through the retry API (${reason??'decoder error'})`,async t=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"resume-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});t.after(async()=>{await browser.close();await server.close();});
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 const recovery={jobId:'a'.repeat(32),stage:'synthesis'},original={id:'v1',soundId:'s',number:1,state:'failed',stage:'导出失败',error:'decoder interrupted',resource:reason?{reason}:undefined,musicRecovery:recovery,input:{soundId:'s',text:'piano',instrumental:true,seed:42,targetDuration:180},source:{kind:'music',id:'a'.repeat(32)},kept:false,deleted:false};
 const state={projects:[{id:'p',title:'恢复验收'}],sounds:[{id:'s',projectId:'p',title:'音乐',kind:'music'}],versions:[original],voices:[],engines:{speech:{logs:[]},music:{logs:[],canGenerate:true}}};
 await page.route('**/api/**',async route=>{
  const name=route.request().url().split('/').at(-1),input=route.request().postDataJSON();
  if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});
  if(name==='studio_retry_music'){
   requests.push({name,input});const version={...original,id:'v2',number:2,state:'queued',stage:'排队中',resource:undefined,error:undefined,musicRecovery:undefined,musicResumedFrom:recovery,parentId:'v1',musicRetryOf:'v1'};state.versions.push(version);return route.fulfill({json:version});
  }
  if(name==='studio_generate')throw Error('Resume must not submit a fresh generation');
  return route.fulfill({json:state});
 });
 await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'继续生成',exact:true}).waitFor();
 assert.match(await page.locator('.player-space').innerText(),/已保存完整声音合成结果，将从音频导出继续/);
 await mkdir('test-results/resume-ui',{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/resume-ui/${reason??'decode'}-${width}.png`});}
 await page.getByRole('button',{name:'继续生成',exact:true}).click();await page.locator('.listening .version-label').filter({hasText:'V2'}).waitFor();
 assert.deepEqual(requests,[{name:'studio_retry_music',input:{versionId:'v1'}}]);assert.equal(state.versions[0].state,'failed');
 assert.match(await page.locator('.player-space').innerText(),/音频导出继续/);assert.deepEqual(errors,[]);
});
