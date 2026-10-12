import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]),url=process.argv[3],result=JSON.parse(await readFile(root+'/alignment.json','utf8')),sample=JSON.parse(await readFile(root+'/sample.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1360,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
 assert.equal(await page.locator('audio').count(),1);assert.equal(await page.locator('#performed .line').count(),result.lines.length);assert.equal(await page.locator('#reference').textContent(),sample.lyrics);assert.equal(await page.locator('.line.uncertain').count(),result.lines.filter(x=>(x.status==='uncertain'||x.timingStatus==='uncertain')).length);
 // Verify every performed candidate survives into the UI, including differences from reference.
 for(const row of result.lines)assert.ok((await page.locator('[data-index="'+row.index+'"]').textContent()).includes(row.text));
 const rows=result.lines.filter(r=>r.end>r.start+.4),checked=[];
 for(const r of [rows[0],rows[Math.floor(rows.length/2)],rows.at(-1)]){await page.locator('audio').evaluate((a,t)=>{a.pause();a.currentTime=t;a.dispatchEvent(new Event('timeupdate'));},(r.start+r.end)/2);assert.equal(await page.locator('#performed .active').getAttribute('data-index'),String(r.index));checked.push(r.index);}
 for(const row of result.lines.filter(r=>r.timingCorrection)){
  for(const t of [row.timingCorrection.before.start+.1,row.start-.1]){
   await page.locator('audio').evaluate((a,t)=>{a.pause();a.currentTime=t;a.dispatchEvent(new Event('timeupdate'));},t);
   assert.equal(await page.locator('[data-index="'+row.index+'"].active').count(),0,'corrected line must not highlight early');
  }
  await page.locator('audio').evaluate((a,t)=>{a.currentTime=t;a.dispatchEvent(new Event('timeupdate'));},row.start+.1);
  assert.equal(await page.locator('[data-index="'+row.index+'"].active').count(),1);
 }
 await page.locator('audio').evaluate(a=>{a.currentTime=0;a.dispatchEvent(new Event('timeupdate'));});assert.equal(await page.locator('.active').count(),0);
 const target=rows[Math.floor(rows.length/2)];await page.locator('[data-index="'+target.index+'"]').click();await page.waitForFunction(()=>!document.querySelector('audio').paused);await page.locator('audio').evaluate(a=>a.pause());assert.ok(Math.abs(await page.locator('audio').evaluate(a=>a.currentTime)-Math.max(0,target.start-.5))<1);
 await page.locator('#performed').dispatchEvent('wheel');assert.match(await page.locator('#follow').innerText(),/关/);await page.locator('#follow').click();assert.match(await page.locator('#follow').innerText(),/开/);
 const waiting=page.waitForEvent('download');await page.locator('a[download]').click();const download=await waiting;assert.equal(await readFile(await download.path(),'utf8'),await readFile(root+'/lyrics.lrc','utf8'));
 await page.screenshot({path:root+'/preview-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:root+'/preview-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 const evidence={correctedBoundaries:result.lines.filter(r=>r.timingCorrection).map(r=>({index:r.index,before:r.timingCorrection.before.start,after:r.start})),singleAudio:true,candidateTextPreserved:true,referenceUnchanged:true,uncertainVisible:result.lines.filter(x=>(x.status==='uncertain'||x.timingStatus==='uncertain')).length,checkedSeekLines:checked,introNotHighlighted:true,clickPlayback:true,followToggle:true,lrcExact:true,mobileNoOverflow:true,pageErrors:errors};await writeFile(root+'/ui-verification.json',JSON.stringify(evidence,null,2));console.log(evidence);
}finally{await browser.close();}
