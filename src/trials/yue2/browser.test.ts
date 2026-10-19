import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {startTrials} from './server.ts';
import type {Job} from './trials.ts';
const abc=readFileSync(new URL('./fixture.abc',import.meta.url),'utf8');
test('two independent pages: import, transfer, constrained proposal, render, cancel and mobile',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'trials-ui-'));let requested:Job|undefined;
 const app=await startTrials({directory,port:0,runner:{close:async()=>{},status:async()=>({}) as any,run:async(job,path,signal,_report,status)=>{requested=job;status('running');_report(JSON.stringify({type:'stage',stage:'Synthesizing audio',completed:2,total:8,unit:'steps'})+'\n');if(job.kind==='plan'){await new Promise<void>((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});}else{mkdirSync(join(path,'song'));writeFileSync(join(path,'song/score.abc'),job.request.params.abc!);writeFileSync(join(path,'song/audio.flac'),'fixture');writeFileSync(join(path,'summary.json'),JSON.stringify({seconds:5,truncated:{abc:false,semantic:true}}));}}}});
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url+'/plan');assert.equal(new URL(page.url()).pathname,'/transfer');assert.equal(await page.locator('nav a').count(),2);assert.equal(await page.locator('#plan-panel, #plan-form').count(),0);await page.locator('summary').filter({hasText:'导入已有'}).click();await page.fill('#description','温暖钢琴');await page.fill('#import-abc',abc);await page.click('#import-button');await page.waitForFunction(()=>document.querySelector('#version-count')?.textContent==='1 个版本');
  await page.click('#audition');await page.click('#stop');
  const first=app.trials.snapshot().versions[0];assert.equal(first.abc,abc);
  await page.click('nav a[href="/transfer"]');await page.click('#transfer-button');await page.waitForFunction(()=>document.querySelector('#version-count')?.textContent==='2 个版本');assert.equal(app.trials.snapshot().versions[1].summary.voices.Vocal.sounding_notes,0);
  await page.click('nav a[href="/edit"]');const second=app.trials.snapshot().versions[1];await page.fill('#proposal',second.abc.replace('"C"','"Am"'));await page.click('#proposal-button');await page.waitForFunction(()=>document.querySelector('#version-count')?.textContent==='3 个版本');
  await page.selectOption('#edit-kind','tempo');await page.fill('#proposal',second.abc.replace('=90','=110'));await page.click('#proposal-button');await page.waitForFunction(()=>document.querySelector('#notice')?.className==='error');assert.equal(app.trials.snapshot().versions.length,3);
  await page.click('#render-button');await page.waitForSelector('audio');assert.ok((await page.locator('#jobs').innerText()).includes('生成达到长度上限'));assert.ok((await page.locator('#jobs').innerText()).includes('2 / 8 步'));assert.equal(requested?.request.params.abc,app.trials.snapshot().versions[2].abc);assert.equal(requested?.request.loras.length,2);
  await page.locator('[data-feedback="adopt"]').click();await page.waitForFunction(()=>document.querySelector('#feedback-state')?.textContent?.includes('已记录'));
  const controllerJob=app.trials.start('plan',first.input,undefined,undefined,async(_job,_path,signal)=>new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));await page.waitForSelector('[data-cancel]');await page.locator(`[data-cancel="${controllerJob.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#jobs')?.textContent?.includes('已取消'));
  mkdirSync('test-results/yue2-trials',{recursive:true});for(const width of [1400,390]){await page.setViewportSize({width,height:1000});for(const route of ['transfer','edit']){await page.goto(app.url+'/'+route);await page.waitForSelector('#version-detail:not([hidden])');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/yue2-trials/${route}-${width}.png`,fullPage:true});}}
  assert.deepEqual(errors,[]);assert.equal(app.trials.snapshot().versions[0].abc,abc);
  const bad=await fetch(app.url+'/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"id":"x"}'});assert.equal(bad.status,400);
 }finally{await browser.close();await app.close();rmSync(directory,{recursive:true,force:true});}
});
