import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]??'test-results/lyrics-alignment-2026-10-12'),url=process.argv[3]??'http://127.0.0.1:5175';
const summaries=JSON.parse(await readFile(root+'/summary.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);assert.equal(await page.locator('#song option').count(),summaries.length);
 const samples=JSON.parse(await readFile(root+'/samples.json','utf8'));
 const checked=[];
 for(let i=0;i<summaries.length;i++){
  const s=summaries[i],payload=JSON.parse(await readFile(root+'/'+s.id+'/alignment.json','utf8'));await page.selectOption('#song',String(i));await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);assert.ok(Math.abs(await page.locator('audio').evaluate(a=>a.duration)-samples.find(x=>x.id===s.id).duration)<.1);assert.equal(await page.locator('.line').count(),payload.lines.length);
  const index=payload.lines.findIndex(r=>r.end-r.start>.6);assert.ok(index>=0);const line=payload.lines[index],t=(line.start+line.end)/2;
  await page.locator('audio').evaluate((a,t)=>{a.pause();a.currentTime=t;a.dispatchEvent(new Event('timeupdate'));},t);await page.waitForFunction(()=>document.querySelectorAll('.line.active').length===1);assert.ok((await page.locator('.line.active').innerText()).includes(line.text));
  await page.locator('#offset').fill('0.1');await page.locator('#offset').dispatchEvent('input');assert.equal(await page.locator('.line.active').count(),1);await page.locator('#offset').fill('0');await page.locator('#offset').dispatchEvent('input');
  await page.locator('#lyrics').dispatchEvent('wheel');assert.match(await page.locator('#follow').innerText(),/关/);await page.locator('#follow').click();assert.match(await page.locator('#follow').innerText(),/开/);
  const waitDownload=page.waitForEvent('download');await page.locator('#download').click();const download=await waitDownload;const text=await readFile(await download.path(),'utf8');assert.match(text,/^\[\d{2}:\d{2}\.\d{2}\]/);assert.equal(text.trim().split('\n').length,payload.lines.length);
  if(i===0)await page.screenshot({path:root+'/preview-desktop.png',fullPage:true});
  checked.push({id:s.id,lyrics:payload.lines.length,download:true,seekHighlight:true});
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:root+'/preview-mobile.png',fullPage:true});assert.deepEqual(errors,[]);const result={checked,mobileNoOverflow:true,pageErrors:errors};await writeFile(root+'/ui-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
