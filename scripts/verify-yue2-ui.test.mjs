import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {processRenderer} from '../src/service/render/process.ts';
import {serveHttp} from '../src/server/http.ts';
let root,service,http,browser;
before(async()=>{root=await mkdtemp(join(tmpdir(),'yue2-ui-'));service=await MusicService.open(root,processRenderer(),p=>readFile(resolve('dist',p)));http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();await http?.close();await service?.close();if(root)await rm(root,{recursive:true,force:true});});
test('ordinary user chooses one directory and starts complete installation; polling preserves edited paths',async t=>{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  const directory='/Users/test/Music/自选模型目录';let submitted;
  await page.route('**/api/yue2_choose_directory',r=>r.fulfill({json:{directory}}));
  await page.route('**/api/prepare_yue2',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{phase:'preparing',directory,installed:false,modelsReady:false,canGenerate:false,autoStart:false,defaultDirectory:directory,message:'下载模型',logs:[]}});});
  await page.goto(http.runtime.url);await page.click('#yue2-enable');await page.click('#yue2-choose');await page.waitForFunction(d=>document.querySelector('#yue2-directory').value===d,directory);
  await page.fill('#yue2-directory',directory+' 修改');await page.waitForTimeout(1700);assert.equal(await page.inputValue('#yue2-directory'),directory+' 修改');
  await page.click('#yue2-install');assert.deepEqual(submitted,{directory:directory+' 修改',downloadModels:true});
});
test('unavailable engine reports failure without removing score playback',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());
  await page.route('**/api/yue2_status',r=>r.fulfill({json:{phase:'failed',installed:true,modelsReady:false,canGenerate:false,autoStart:false,directory:'/selected',defaultDirectory:'/selected',message:'Metal 启动失败',error:'Metal 启动失败',logs:['诊断日志']}}));
  await page.goto(http.runtime.url);await page.locator('#yue2-state').filter({hasText:'Metal 启动失败'}).waitFor();
  assert.ok(await page.locator('#play').isEnabled());assert.ok(await page.locator('#yue2-start').isVisible());assert.ok(await page.locator('#yue2-generate').isDisabled());
});
