import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {encodeWav} from '../src/wav.ts';
test('music version edits support any AI, durable drafts, mobile layout and normal child versions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'music-edits-ui-'));
 const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const abc=await readFile('src/trials/yue2/fixture.abc','utf8'),requests=[],jobs=[];
 service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
 service.yue2Client.list=async()=>({jobs});service.yue2Client.score=async()=>abc;
 service.yue2Client.generate=async args=>{requests.push(structuredClone(args));const job={id:crypto.randomUUID().replaceAll('-',''),status:'done',kind:'create',title:args.title};jobs.push(job);return {job};};
 service.yue2Client.audio=async()=>Buffer.from(encodeWav([new Float32Array(22050)],22050));
 await service.call('create_project',{projectId:'ui-edit',title:'改谱验证'});const sound=await service.call('studio_create_sound',{projectId:'ui-edit',title:'原歌曲',kind:'music'});
 const source=await service.call('studio_generate',{soundId:sound.id,text:'温暖钢琴伴奏',instrumental:false,lyrics:'[verse]\n春天来了\n[outro]',seed:42});
 await service.call('studio_update_version',{versionId:source.id,final:true});
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const entry=async action=>{await page.locator('.music-edit-menu summary').click({timeout:3000});await page.click(`[data-action="${action}"]`);await page.locator('#edit-style').waitFor();};
 try{
  await page.goto(http.runtime.url);await entry('music-transfer');assert.match(await page.locator('#dialog').innerText(),/基于 V1/);
  await page.fill('#edit-style','钢琴演奏主旋律，纯器乐');await page.click('#edit-prepare');await page.locator('#edit-generate:not([disabled])').waitFor();assert.equal(requests.length,1);
  await page.click('[data-action="close"]');await page.reload();await entry('music-transfer');assert.equal(await page.inputValue('#edit-style'),'钢琴演奏主旋律，纯器乐');
  await page.fill('#edit-style','新的描述');assert.equal(await page.isDisabled('#edit-generate'),true);await page.click('#edit-prepare');await page.locator('#edit-generate:not([disabled])').waitFor();
  await mkdir('test-results/music-edits',{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/music-edits/transfer-${width}.png`,fullPage:true});}
  await page.click('#edit-generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(requests.length,2);assert.equal(requests[1].instrumental,true);assert.doesNotMatch(requests[1].lyrics,/春天/);
  const lib=await service.call('studio_library',{}),child=lib.versions.find(v=>v.parentId===source.id);assert.equal(child.musicEdit.label,'器乐演奏版');assert.equal(lib.sounds[0].finalVersionId,source.id);
  await page.click(`[data-action="version"][data-id="${source.id}"]`);await entry('music-edit');assert.doesNotMatch(await page.locator('#dialog').innerText(),/Codex/);
  await page.fill('#edit-instruction','仅把和声改得更明亮');const download=page.waitForEvent('download');await page.click('#edit-export');const file=await download;assert.match(await readFile(await file.path(),'utf8'),/任意 AI \/ LLM/);
  await page.fill('#edit-abc',abc.replace('C32','D32'));await page.click('#edit-prepare');await page.getByText(/保留约束失败/).waitFor();assert.equal(await page.isDisabled('#edit-generate'),true);
  await page.fill('#edit-abc',abc.replace('"C"','"Am"'));await page.click('#edit-prepare');await page.locator('#edit-generate:not([disabled])').waitFor();
  await page.selectOption('#edit-kind','tempo');await page.locator('#edit-bpm').waitFor();await page.fill('#edit-bpm','110');await page.click('#edit-prepare');await page.locator('#edit-generate:not([disabled])').waitFor();assert.match(await page.locator('#edit-result').innerText(),/110 BPM/);
  await page.selectOption('#edit-kind','section');await page.locator('#edit-section').waitFor();await page.click('#edit-prepare');await page.locator('#edit-generate:not([disabled])').waitFor();assert.match(await page.locator('#edit-result').innerText(),/3 个段落/);
  await page.screenshot({path:'test-results/music-edits/section-390.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
