import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

async function fixture(t){
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"recovery-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 t.after(async()=>{await browser.close();await server.close();});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state={hang:false,fail:false,done:false,reads:0};
 await page.route('**/api/**',async route=>{
  if(route.request().url().endsWith('/resource_status'))return route.fulfill({json:{queued:[],paused:false}});
  state.reads++;
  if(state.hang)return;
  if(state.fail)return route.abort();
  return route.fulfill({json:{projects:[{id:'p',title:'项目'}],sounds:[{id:'s',projectId:'p',title:'音乐',kind:'music'}],versions:[{id:'v',soundId:'s',number:1,state:state.done?'succeeded':'running',stage:state.done?'生成完成':'正在生成',source:{kind:'music',id:'job'},kept:false,deleted:false}],voices:[],engines:{speech:{logs:[]},music:{logs:[]}}}});
 });
 await page.goto(server.resolvedUrls.local[0]);
 await page.locator('.listening .tag').filter({hasText:'生成中'}).waitFor();
 return {page,state,errors};
}

test('a hung status read times out visibly and polling recovers without reload',async t=>{
 const {page,state,errors}=await fixture(t);
 state.hang=true;
 await page.locator('#library-connection').filter({hasText:'自动重连'}).waitFor({timeout:15000});
 state.hang=false;state.done=true;
 await page.getByRole('button',{name:'选为成品',exact:true}).waitFor({timeout:6000});
 assert.equal(await page.locator('#library-connection').isVisible(),false);
 assert.deepEqual(errors,[]);
});

for(const event of ['focus','online','pageshow','visibilitychange'])test(`${event} recovers failed reads while preserving an open creation draft`,async t=>{
 const {page,state,errors}=await fixture(t);
 await page.click('[data-action="compose"]');await page.fill('#creation-text','保留这段尚未提交的创作要求');
 state.fail=true;
 await page.locator('#library-connection').filter({hasText:'自动重连'}).waitFor();
 state.fail=false;state.done=true;
 await page.evaluate(event=>(event==='visibilitychange'?document:window).dispatchEvent(new Event(event)),event);
 await page.getByRole('button',{name:'选为成品',exact:true}).waitFor({state:'attached',timeout:1200});
 assert.equal(await page.inputValue('#creation-text'),'保留这段尚未提交的创作要求');
 assert.ok(await page.locator('dialog').evaluate(e=>e.open));
 assert.deepEqual(errors,[]);
});


test('a transient rendering failure retries the same completed snapshot',async t=>{
 const {page,state,errors}=await fixture(t);
 await page.evaluate(()=>{
  const original=Element.prototype.replaceChildren;
  Element.prototype.replaceChildren=function(...nodes){
   if(this.id==='workspace'){Element.prototype.replaceChildren=original;throw Error('temporary render failure');}
   return original.apply(this,nodes);
  };
 });
 state.done=true;
 await page.locator('#library-connection').filter({hasText:'自动重连'}).waitFor();
 await page.getByRole('button',{name:'选为成品',exact:true}).waitFor({timeout:5000});
 assert.equal(await page.locator('#library-connection').isVisible(),false);
 assert.deepEqual(errors,[]);
});
