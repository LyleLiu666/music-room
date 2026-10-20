import test from 'node:test';import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';import {createServer} from 'vite';import {chromium} from 'playwright';
test('task page retains completed results, navigates across projects, and project search paginates',async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"history-test"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let completed=false;
 const projects=Array.from({length:19},(_,i)=>({id:`p${i}`,title:`项目 ${i}`}));
 const v={id:'v',soundId:'s',number:3,state:'succeeded',stage:'已完成',createdAt:'2026-10-20T01:00:00Z',source:{kind:'music',id:'job'},input:{text:'piano',instrumental:true}};
 await page.route('**/api/**',async r=>{
  if(r.request().url().endsWith('/resource_status'))return r.fulfill({json:{queued:[],paused:false}});
  return r.fulfill({json:{projects,sounds:[{id:'s',projectId:'p18',title:'钢琴',kind:'music'}],versions:[v],taskHistory:[{...v,state:completed?'succeeded':'running',stage:completed?'已完成':'正在生成',hasAudio:completed}],backgroundVersions:[],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[]},conversion:{}}}});
 });
 try{
  await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'任务列表',exact:true}).click();await page.locator('.task-history-row').getByText('进行中 · 正在生成',{exact:true}).waitFor();
  completed=true;await page.getByRole('button',{name:'查看生成结果',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'任务列表',exact:true}).waitFor();await page.getByRole('button',{name:'查看生成结果',exact:true}).click();await page.locator('.listening .version-label').getByText('V3',{exact:true}).waitFor();assert.equal(await page.locator('.project-header h1').textContent(),'项目 18');
  assert.equal(await page.locator('#projects button').count(),6);await page.getByRole('button',{name:'下一页项目'}).click();await page.locator('#projects').getByText('项目 6',{exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索项目'}).fill('项目 18');assert.equal(await page.locator('#projects button').count(),1);await page.locator('#projects').getByText('项目 18',{exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索项目'}).fill('不存在');assert.equal(await page.locator('#projects button').count(),0);await page.getByRole('searchbox',{name:'搜索项目'}).fill('');
  await page.getByRole('button',{name:'任务列表',exact:true}).click();await mkdir('test-results/task-history',{recursive:true});await page.screenshot({path:'test-results/task-history/desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/task-history/mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
