import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const workspace=resolve(process.env.MUSIC_ROOM_SYSTEM_WORKSPACE??'test-results/system-ui/workspace');
assert.ok(workspace.startsWith(resolve('test-results')+'/'),'only disposable acceptance workspaces');
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
const out=resolve('test-results/system-lifecycle');await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),status:'running',checks:[],scope:{network:'Chrome context offline/online; host network remains available',suspension:'SIGSTOP/SIGCONT of this isolated service; does not claim macOS sleep/wake'}};
const call=async(name,args={})=>{const r=await fetch(runtime.url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return r.json();};
let browser,suspended=false;
try{
 const snapshot=await call('studio_library'),voice=snapshot.versions.find(v=>v.source.kind==='speech'&&v.state==='succeeded');assert.ok(voice);
 const sound=snapshot.sounds.find(s=>s.id===voice.soundId),audio=await fetch(runtime.url+voice.audioPath,{headers:{authorization:'Bearer '+runtime.token}});assert.equal(audio.status,200);const bytes=Buffer.from(await audio.arrayBuffer()),sha=createHash('sha256').update(bytes).digest('hex');
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const context=await browser.newContext({viewport:{width:1440,height:1000}});let page=await context.newPage();
 const select=async()=>{await page.goto(runtime.url);await page.locator(`[data-action="project"][data-id="${sound.projectId}"]`).click();await page.locator(`[data-action="sound"][data-id="${sound.id}"]`).click();await page.locator('#version-audio').waitFor();};await select();
 await context.setOffline(true);
 await page.locator('[data-action="compose"]').first().click();await page.fill('#creation-text','断网期间保留的本地草稿');await page.locator('#draft-save-status').filter({hasText:'草稿已保存'}).waitFor();
 await page.locator('#generate').click();await page.waitForTimeout(1200);
 assert.equal((await call('studio_library')).versions.length,snapshot.versions.length,'offline click cannot silently create a server task');
 assert.ok(await page.getByRole('dialog').isVisible());assert.equal(await page.inputValue('#creation-text'),'断网期间保留的本地草稿');
 await page.screenshot({path:join(out,'offline.png'),fullPage:true});
 await context.setOffline(false);await page.keyboard.press('Escape');await page.reload();await page.locator('[data-action="compose"]').first().click();assert.equal(await page.inputValue('#creation-text'),'断网期间保留的本地草稿');await page.keyboard.press('Escape');
 report.checks.push('offline submission creates no phantom task; input survives reconnect and reload');
 for(const p of context.pages())await p.close();assert.equal(context.pages().length,0);assert.equal((await call('tts_get_version',{versionId:voice.id})).state,'succeeded');page=await context.newPage();await select();
 const downloaded=await page.request.get(runtime.url+voice.audioPath,{headers:{authorization:'Bearer '+runtime.token}});assert.equal(createHash('sha256').update(await downloaded.body()).digest('hex'),sha);report.checks.push('closing every test page leaves background service and real saved audio intact; reopen recovers view');
 process.kill(runtime.pid,'SIGSTOP');suspended=true;
 await assert.rejects(fetch(runtime.url+'/local-session',{signal:AbortSignal.timeout(500)}));
 process.kill(runtime.pid,'SIGCONT');suspended=false;
 assert.equal((await call('tts_get_version',{versionId:voice.id})).state,'succeeded');assert.deepEqual(Buffer.from(await (await fetch(runtime.url+voice.audioPath,{headers:{authorization:'Bearer '+runtime.token}})).arrayBuffer()),bytes);
 report.checks.push('isolated service suspension causes a real request timeout, then resume restores status and byte-identical audio');
 report.audio={versionId:voice.id,sha256:sha,bytes:bytes.length};report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{if(suspended)process.kill(runtime.pid,'SIGCONT');await browser?.close();report.finishedAt=new Date().toISOString();await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
