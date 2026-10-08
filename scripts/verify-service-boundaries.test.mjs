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
before(async()=>{
  root=await mkdtemp(join(tmpdir(),'music-ui-boundaries-'));
  service=await MusicService.open(root,processRenderer(),p=>readFile(resolve('dist',p)));
  await service.call('import_revision',{compositionJson:await readFile('src/music/authoring/example.json','utf8')});
  http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});
  browser=await chromium.launch({channel:'chrome',headless:true});
});
after(async()=>{
  await browser?.close();await service?.jobs.close();await http?.close();await service?.store.close();
  if(root)await rm(root,{recursive:true,force:true});
});
async function pageFor(t) {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  return page;
}
async function select(page,id) {
  await page.evaluate(id=>{location.hash=id;},id);
  await page.waitForFunction(id=>window.musicRoom.songId===id,id);
}

for(const action of ['continue-editing','switch-version','edit-back-to-same-text'])test(`saving feedback preserves a later draft: ${action}`,async t=>{
  const page=await pageFor(t);
  await page.goto(http.runtime.url+'/#window-study-v1');
  let release,entered;
  const held=new Promise(r=>{release=r;}),sent=new Promise(r=>{entered=r;});
  await page.route('**/api/add_feedback',async route=>{entered();await held;await route.continue();});
  t.after(()=>release());
  const original=`已提交意见 ${action}`,next=action==='edit-back-to-same-text'?original:`新的草稿 ${action}`;
  await page.fill('#service-feedback',original);await page.click('#service-save-feedback');await sent;
  assert.equal(await page.locator('#service-save-feedback').isDisabled(),true,'one submission at a time');
  await page.fill('#service-feedback','中途修改');await page.fill('#service-feedback',next);
  if(action==='switch-version') {
    await select(page,'rain-letter-v2');await page.fill('#service-feedback','另一版本的草稿');
  }
  const response=page.waitForResponse(r=>r.url().endsWith('/api/add_feedback'));release();await response;
  await page.locator('#status').filter({hasText:'听评已保存'}).waitFor();
  if(action==='switch-version') {
    assert.equal(await page.inputValue('#service-feedback'),'另一版本的草稿');
    await select(page,'window-study-v1');
  }
  assert.equal(await page.inputValue('#service-feedback'),next,'completion must clear only the exact unchanged submission');
  const {feedback}=await service.call('get_project',{projectId:'window-study'});
  assert.ok(feedback.some(f=>f.text===original));assert.ok(!feedback.some(f=>f.text===`新的草稿 ${action}`));
});

test('failed feedback remains editable; successful unchanged feedback is cleared',async t=>{
  const page=await pageFor(t);await page.goto(http.runtime.url+'/#window-study-v1');
  await page.route('**/api/add_feedback',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'feedback write failure'})}));
  await page.fill('#service-feedback','失败后保留');await page.click('#service-save-feedback');
  await page.locator('#status').filter({hasText:'feedback write failure'}).waitFor();
  assert.equal(await page.inputValue('#service-feedback'),'失败后保留');
  assert.equal(await page.locator('#service-save-feedback').isEnabled(),true);
  await page.unroute('**/api/add_feedback');await page.click('#service-save-feedback');
  await page.locator('#service-feedback-list').filter({hasText:'失败后保留'}).waitFor();
  assert.equal(await page.inputValue('#service-feedback'),'');
});

test('successful unchanged feedback clears its hidden draft only',async t=>{
  const page=await pageFor(t);await page.goto(http.runtime.url+'/#window-study-v1');
  let release,entered;const held=new Promise(r=>{release=r;}),sent=new Promise(r=>{entered=r;});
  await page.route('**/api/add_feedback',async route=>{entered();await held;await route.continue();});t.after(()=>release());
  await page.fill('#service-feedback','切换前提交');await page.click('#service-save-feedback');await sent;
  await select(page,'rain-letter-v2');await page.fill('#service-feedback','另一版需要保留');release();
  await page.locator('#status').filter({hasText:'听评已保存'}).waitFor();
  assert.equal(await page.inputValue('#service-feedback'),'另一版需要保留');
  await select(page,'window-study-v1');assert.equal(await page.inputValue('#service-feedback'),'');
});

for(const intent of ['original-link','new-navigation','confirmed-missing'])test(`library recovery honors ${intent}`,async t=>{
  const page=await pageFor(t);let available=false;
  await page.route('**/api/library',route=>available?route.continue():route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'temporary disconnect'})}));
  const requested=intent==='confirmed-missing'?'missing-version':'window-study-v1';
  await page.goto(http.runtime.url+'/#'+requested);
  assert.equal(await page.evaluate(()=>location.hash),'#'+requested,'unverified links must survive connection failure');
  if(intent==='new-navigation')await select(page,'rain-letter-v1');
  available=true;
  await page.locator('#service-state').filter({hasText:'已连接'}).waitFor();
  const expected=intent==='original-link'?'window-study-v1':intent==='new-navigation'?'rain-letter-v1':'rain-letter-v2';
  await page.waitForFunction(id=>window.musicRoom.songId===id,expected);
  assert.equal(await page.evaluate(()=>location.hash),'#'+expected);
  if(intent==='confirmed-missing')await page.locator('#status').filter({hasText:'未找到该版本'}).waitFor();
});
