import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
const workspace=resolve(process.env.MUSIC_ROOM_SYSTEM_WORKSPACE??'test-results/system-ui/workspace');
assert.ok(workspace.startsWith(resolve('test-results')+'/'));
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
const out=resolve('test-results/zoom-ui');await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'music-zoom-'));await mkdir(join(profile,'Default'));
// Chromium's persisted browser zoom, in a disposable profile. No CSS zoom or
// device-scale emulation. Both partition encodings cover supported Chrome builds.
// https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc
const level=Math.log(2)/Math.log(1.2);await writeFile(join(profile,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{'0':level,x:level}}}));
const report={startedAt:new Date().toISOString(),zoom:200,status:'running',checks:[],screenshots:[]};let context,page;
const screenshot=async path=>{const session=await context.newCDPSession(page);try{const {data}=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(path,Buffer.from(data,'base64'));}finally{await session.detach();}};
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:null,args:['--window-size=1440,1000']});
 page=context.pages()[0];page.setDefaultTimeout(10000);await page.goto(runtime.url);
 report.metrics=await page.evaluate(()=>({dpr:devicePixelRatio,innerWidth,outerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(Math.abs(report.metrics.dpr-2)<.02,'browser zoom must actually be 200% on a 1x test display');assert.ok(report.metrics.innerWidth<=730,'desktop content must reflow into half the CSS width');
 const call=async(name,args={})=>{const response=await fetch(runtime.url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:JSON.stringify(args)});assert.equal(response.status,200);return response.json();};
 const snapshot=await call('studio_library'),v=snapshot.versions.find(v=>v.source.kind==='speech'&&v.state==='succeeded'),sound=snapshot.sounds.find(s=>s.id===v.soundId);
 if(!snapshot.projects.some(p=>p.id==='zoom-trash'))await call('create_project',{projectId:'zoom-trash',title:'200% 回收站样本'});
 const original=await fetch(runtime.url+v.audioPath,{headers:{authorization:'Bearer '+runtime.token}}),audioHash=createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex');
 const snapshotScreen=async name=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal document overflow');const path=join(out,name+'.png');await screenshot(path);report.screenshots.push(path);};
 for(const theme of ['日间','夜间']){
  await page.locator(`[data-theme-choice="${theme==='日间'?'light':'dark'}"]`).first().click();
  await page.locator(`[data-action="project"][data-id="${sound.projectId}"]`).click();await page.locator(`[data-action="sound"][data-id="${sound.id}"]`).click();await page.locator('#version-audio').waitFor();await snapshotScreen(theme+'-version');
  await page.locator('[data-action="compose"]').first().click();await page.locator('#creation-text').fill('200% 缩放检查：正文、错误提示和提交入口都应可见。');await page.locator('#draft-save-status').filter({hasText:'草稿已保存'}).waitFor();await snapshotScreen(theme+'-compose');assert.ok(await page.locator('#generate').isVisible());await page.keyboard.press('Escape');
  const menu=page.locator('.more-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();await page.locator('[data-action="download-original"]').waitFor();await snapshotScreen(theme+'-menu');
  const downloading=page.waitForEvent('download');await page.locator('[data-action="download-original"]').click();const download=await downloading;assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'),audioHash);if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();
  await page.locator('[data-action="new-project"]').click();await page.locator('#project-name').fill('200% 新建入口检查');await snapshotScreen(theme+'-new-project');await page.keyboard.press('Escape');
  await page.locator('[data-action="settings"]').click();await page.getByRole('dialog').waitFor();await snapshotScreen(theme+'-settings');await page.keyboard.press('Escape');
  await call('studio_update_project',{projectId:'zoom-trash',deleted:true});await page.locator('[data-action="settings"]').click();await page.locator('[data-action="trash"]').click();await page.locator('[data-action="restore-entity"][data-id="zoom-trash"]').waitFor();await snapshotScreen(theme+'-trash');await page.locator('[data-action="restore-entity"][data-id="zoom-trash"]').click();await page.locator('[data-action="restore-entity"][data-id="zoom-trash"]').waitFor({state:'detached'});await page.keyboard.press('Escape');
 }
 report.checks.push('actual 200% browser zoom confirmed by DPR and CSS viewport','light and dark version/form/menu/settings/new-project/trash retain controls without horizontal document overflow','download remains byte-identical and trash restore is clickable in both themes');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);if(page)await screenshot(join(out,'failure.png'));throw error;}
finally{await context?.close();await rm(profile,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
