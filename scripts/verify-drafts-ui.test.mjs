import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,webkit} from 'playwright';
const engine=process.env.MUSIC_ROOM_BROWSER??'chrome';
assert.ok(['chrome','webkit'].includes(engine));
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {testResources} from '../src/service/resources/testing.ts';
async function fixture(t,kind='speech'){
 const root=await mkdtemp(join(tmpdir(),'drafts-ui-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,undefined,undefined,undefined,testResources());
 const http=await serveHttp(service,assets),browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
 t.after(async()=>{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});});
 await service.call('create_project',{projectId:'drafts',title:'草稿测试'});
 const sounds=[];for(const title of ['声音甲','声音乙'])sounds.push(await service.call('studio_create_sound',{projectId:'drafts',title,kind}));
 const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
 for(const page of [a,b]){page.setDefaultTimeout(10000);await page.goto(http.runtime.url);await page.locator('[data-action="compose"]').first().waitFor();}
 const compose=async(page,index)=>{await page.locator(`[data-action="sound"][data-id="${sounds[index].id}"]`).click();await page.locator('[data-action="compose"]').first().click();};
 const saved=page=>page.locator('#draft-save-status').filter({hasText:'草稿已保存'}).waitFor();
 return {a,b,compose,saved};
}
test('two tabs edit different sounds without losing drafts on stale navigation or reload',async t=>{
 const {a,b,compose,saved}=await fixture(t);
 await compose(a,0);await a.fill('#creation-text','甲的草稿');await saved(a);
 await compose(b,1);await b.fill('#creation-text','乙的草稿');await saved(b);
 await b.click('[data-action="close"]');await b.locator('[data-action="sound"]').first().click();
 await a.reload();await compose(a,0);assert.equal(await a.inputValue('#creation-text'),'甲的草稿');
 await b.reload();await compose(b,1);assert.equal(await b.inputValue('#creation-text'),'乙的草稿');
});
test('opening an untouched creation form finishes saving its initial defaults',async t=>{
 const {a,compose,saved}=await fixture(t);await a.bringToFront();await a.waitForTimeout(300);
 await compose(a,0);await saved(a);assert.equal(await a.inputValue('#creation-text'),'');
 await a.reload();await compose(a,0);await saved(a);assert.equal(await a.inputValue('#creation-text'),'');
});
for(const choice of ['保留当前内容','使用已保存内容'])test(`same-sound conflict preserves input until explicit choice: ${choice}`,async t=>{
 const {a,b,compose,saved}=await fixture(t);await compose(a,0);await compose(b,0);
 await a.fill('#creation-text','甲窗口');await saved(a);
 await b.fill('#creation-text','乙窗口');await b.getByRole('button',{name:choice,exact:true}).waitFor();
 assert.equal(await b.inputValue('#creation-text'),'乙窗口');
 await b.getByRole('button',{name:choice,exact:true}).click();await saved(b);await b.reload();await compose(b,0);
 assert.equal(await b.inputValue('#creation-text'),choice==='保留当前内容'?'乙窗口':'甲窗口');
});
test('browser storage failure is visible, keeps editable text and supports an explicit retry',async t=>{
 const {a,compose,saved}=await fixture(t);await compose(a,0);
 await a.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes(':draft:'))throw new DOMException('Full','QuotaExceededError');return window.originalSetItem.call(this,key,value);};});
 await a.fill('#creation-text','保存失败也不能丢');await a.getByRole('button',{name:'重试保存草稿'}).waitFor();
 assert.equal(await a.inputValue('#creation-text'),'保存失败也不能丢');
 await a.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});await a.getByRole('button',{name:'重试保存草稿'}).click();await saved(a);
 await a.reload();await compose(a,0);assert.equal(await a.inputValue('#creation-text'),'保存失败也不能丢');
});

test('conversion draft conflict preserves pitch selection until explicit saved-choice resolution',async t=>{
 const {a,b,compose,saved}=await fixture(t,'conversion');await compose(a,0);await compose(b,0);
 await a.selectOption('#conversion-pitch','2');await saved(a);
 await b.selectOption('#conversion-pitch','3');await b.getByRole('button',{name:'使用已保存内容',exact:true}).waitFor();
 assert.equal(await b.inputValue('#conversion-pitch'),'3');await b.getByRole('button',{name:'使用已保存内容',exact:true}).click();await saved(b);
 assert.equal(await b.inputValue('#conversion-pitch'),'2');
});
