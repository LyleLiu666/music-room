import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
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
test('instrumental and vocal examples work before installation and never generate automatically',async t=>{
  const page=await browser.newPage(),errors=[];let generated=0;
  page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  await page.route('**/api/yue2_generate',r=>{generated++;return r.fulfill({json:{}});});
  await page.goto(http.runtime.url);
  await page.locator('#yue2-state').filter({hasText:'尚未启用'}).waitFor();
  const examples=page.getByRole('group',{name:'提示词示例'});
  assert.equal(await examples.getByRole('button').count(),7);
  assert.match(await examples.innerText(),/替换/);
  for(const name of ['钢琴 R&B','古筝与钢琴','松弛爵士','轻快律动']){
    await page.fill('#yue2-title','原有草稿');await page.fill('#yue2-style','原有描述');
    await page.locator('#yue2-settings').evaluate(el=>{el.open=true;});
    await page.fill('#yue2-lyrics','原有歌词');await page.uncheck('#yue2-instrumental');await page.selectOption('#yue2-preset','quality');
    await examples.getByRole('button',{name:'填入'+name,exact:true}).click();
    assert.notEqual(await page.inputValue('#yue2-title'),'原有草稿');
    assert.match(await page.inputValue('#yue2-style'),/Instrumental/);
    assert.match(await page.inputValue('#yue2-lyrics'),/^\[[a-z]+\](\n\[[a-z]+\])*$/);
    assert.ok(await page.isChecked('#yue2-instrumental'));assert.equal(await page.inputValue('#yue2-preset'),'fast');
    assert.match(await page.locator('#yue2-example-status').innerText(),/已填入/);
  }
  for(const [name,language] of [['中文男声 R&B',/[\u4e00-\u9fff]/],['中文女声民谣',/[\u4e00-\u9fff]/],['英文女声 City Pop',/Morning light/]]){
    await examples.getByRole('button',{name:'填入'+name,exact:true}).click();
    assert.equal(await page.isChecked('#yue2-instrumental'),false);
    assert.equal(await page.inputValue('#yue2-preset'),'fast');
    assert.match(await page.inputValue('#yue2-style'),/lead vocal/);
    const lyrics=await page.inputValue('#yue2-lyrics');assert.match(lyrics,/\[Verse\]/);assert.match(lyrics,/\[Chorus\]/);assert.match(lyrics,language);
    assert.ok(await page.locator('#yue2-lyrics').isVisible());
    assert.match(await page.locator('#yue2-example-status').innerText(),/带人声/);
  }
  await examples.getByRole('button',{name:'填入钢琴 R&B',exact:true}).click();
  assert.ok(await page.isChecked('#yue2-instrumental'));assert.equal(await page.inputValue('#yue2-lyrics'),'[intro]\n[verse]\n[chorus]\n[outro]');
  assert.equal(generated,0);assert.ok(await page.locator('#yue2-generate').isDisabled());
});
test('lyric example submits editable lyrics in vocal mode without instrumental adapters',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());let submitted;
  await page.route('**/api/yue2_status',r=>r.fulfill({json:{phase:'running',installed:true,modelsReady:true,canGenerate:true,autoStart:true,directory:'/selected',defaultDirectory:'/selected',message:'服务已启动',logs:[]}}));
  await page.route('**/api/yue2_list_jobs',r=>r.fulfill({json:{jobs:[]}}));
  await page.route('**/api/yue2_generate',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{job:{id:'b'.repeat(32),status:'queued'}}});});
  await page.goto(http.runtime.url);await page.getByRole('button',{name:'填入中文女声民谣',exact:true}).click();
  const lyrics=(await page.inputValue('#yue2-lyrics')).replace('时间慢得刚刚好','日子慢得刚刚好');await page.fill('#yue2-lyrics',lyrics);
  await page.click('#yue2-generate');await page.waitForFunction(()=>document.querySelector('#yue2-generate').disabled===false);
  assert.equal(submitted.instrumental,false);assert.equal(submitted.lyrics,lyrics);assert.equal(submitted.preset,'fast');assert.equal(submitted.title,'风来时');assert.match(submitted.style,/female lead vocal/);
});
test('user edits an example and explicitly submits the edited prompt; polling keeps the draft',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());let submitted;
  await page.route('**/api/yue2_status',r=>r.fulfill({json:{phase:'running',installed:true,modelsReady:true,canGenerate:true,autoStart:true,directory:'/selected',defaultDirectory:'/selected',message:'服务已启动',logs:[]}}));
  await page.route('**/api/yue2_list_jobs',r=>r.fulfill({json:{jobs:[]}}));
  await page.route('**/api/yue2_generate',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{job:{id:'a'.repeat(32),status:'queued'}}});});
  await page.goto(http.runtime.url);await page.getByRole('button',{name:'填入钢琴 R&B',exact:true}).click();
  const original=await page.inputValue('#yue2-style');assert.match(original,/two-bar piano riff/);
  const edited=original+' Add a soft flute answering phrase.';await page.fill('#yue2-style',edited);await page.fill('#yue2-title','我的第一首');
  await page.waitForTimeout(2200);assert.equal(await page.inputValue('#yue2-style'),edited);assert.equal(submitted,undefined);
  await page.click('#yue2-generate');await page.waitForFunction(()=>document.querySelector('#yue2-generate').disabled===false);
  assert.deepEqual(submitted,{title:'我的第一首',style:edited,lyrics:'[intro]\n[verse]\n[chorus]\n[outro]',instrumental:true,preset:'fast'});
});
test('examples remain readable and editable on desktop and mobile',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await mkdir('test-results/yue2-examples',{recursive:true});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(http.runtime.url);
    const examples=page.getByRole('group',{name:'提示词示例'});await examples.waitFor();
    assert.equal(await examples.getByRole('button').count(),7);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    for(const button of await examples.getByRole('button').all()){
      const box=await button.boundingBox();assert.ok(box&&box.width>70&&box.height>=30);
      await button.click();
    }
    await examples.screenshot({path:`test-results/yue2-examples/${width}.png`});
    await examples.getByRole('button',{name:'填入英文女声 City Pop',exact:true}).click();
    assert.ok(await page.locator('#yue2-lyrics').isVisible());assert.equal(await page.isChecked('#yue2-instrumental'),false);
  }
});
