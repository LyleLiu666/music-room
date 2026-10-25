import test from 'node:test';import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';import {createServer} from 'vite';import {chromium,webkit} from 'playwright';
const engine=process.env.MUSIC_ROOM_BROWSER??'chrome';
assert.ok(['chrome','webkit'].includes(engine),'MUSIC_ROOM_BROWSER must be chrome or webkit');
test('task page retains completed results, navigates across projects, and project search paginates',async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"history-test"}</script></head>')}]});await server.listen();
 const browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let completed=false,many=false;
 const out=`test-results/task-history/${engine}/sidebar`,policy={reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8};
 const projects=Array.from({length:19},(_,i)=>({id:`p${i}`,title:i===0?'长项目名称 · 钢琴与弦乐的春日创作合集':`项目 ${i}`}));
 const v={id:'v',soundId:'s',number:3,state:'succeeded',stage:'已完成',createdAt:'2026-10-20T01:00:00Z',source:{kind:'music',id:'job'},input:{text:'piano',instrumental:true}};
 await page.route('**/api/**',async r=>{
  if(r.request().url().endsWith('/resource_status'))return r.fulfill({json:{queued:[],paused:false,residents:[],history:[],policy}});
  if(r.request().url().endsWith('/monitor_status'))return r.fulfill({json:{sampledAt:Date.now(),cpuCount:8,resources:{policy,hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure:'normal',memory:{compressed:0,swapUsed:0},pools:[{id:'memory',capacity:32*2**30,available:16*2**30,owned:2**30}]}},system:{cpuPercent:39,memoryUsed:16*2**30,memoryTotal:32*2**30},application:{cpuPercent:.2,memoryBytes:.1*2**30,processCount:1,memoryKind:'footprint'}}});
  return r.fulfill({json:{projects,sounds:[{id:'s',projectId:'p18',title:'钢琴',kind:'music'}],versions:[v],taskHistory:many?Array.from({length:26},(_,i)=>({...v,id:'v'+i,number:i+1,state:['running','queued','succeeded','failed','cancelled','interrupted'][i%6],stage:'生成中',error:i%6===3?'ValueError: 乐谱未完成\n详细原因'.repeat(20):undefined,hasAudio:i%6===2,duration:i%6===2?224:undefined,createdAt:new Date(1792500000000+i*60000).toISOString()})):[{...v,state:completed?'succeeded':'running',stage:completed?'已完成':'正在生成',hasAudio:completed}],backgroundVersions:[],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{logs:[]},conversion:{}}}});
 });
 try{
  page.setDefaultTimeout(10000);await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'任务列表',exact:true}).click();await page.locator('.task-history-row .task-state--running').waitFor();
  completed=true;await page.getByRole('button',{name:'查看生成结果',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'任务列表',exact:true}).waitFor();await page.getByRole('button',{name:'钢琴 · V3',exact:true}).click();await page.locator('.listening .version-label').getByText('V3',{exact:true}).waitFor();assert.equal(await page.locator('.project-header h1').textContent(),'项目 18');
  await mkdir(out,{recursive:true});
  for(const viewport of [{width:1280,height:720},{width:900,height:600}]){
   await page.setViewportSize(viewport);
   await page.getByText('39.0%',{exact:true}).waitFor();
   await page.waitForFunction(()=>{const el=document.querySelector('#projects');return el.scrollHeight<=el.clientHeight+1;});
   const layout=await page.evaluate(()=>{
    const search=document.querySelector('#project-search').getBoundingClientRect(),create=document.querySelector('.sidebar [data-action="new-project"]').getBoundingClientRect(),list=document.querySelector('#projects'),bounds=list.getBoundingClientRect();
    return {sameRow:Math.abs(search.top-create.top)<2,overlap:search.right>create.left,rows:[...list.children].map(el=>{const r=el.getBoundingClientRect();return r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1;}),horizontalOverflow:list.scrollWidth>list.clientWidth+1};
   });
   assert.ok(layout.sameRow,'project search and creation share one row');assert.equal(layout.overlap,false);assert.ok(layout.rows.every(Boolean),'every project on this page is fully visible');assert.equal(layout.horizontalOverflow,false);
   const seen=new Set();
   for(let i=0;i<19;i++){
    assert.ok(await page.locator('#projects').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'each project page fits without internal scrolling');
    for(const id of await page.locator('#projects button').evaluateAll(rows=>rows.map(row=>row.dataset.id)))seen.add(id);
    if(await page.getByRole('button',{name:'下一页项目'}).isDisabled())break;
    await page.getByRole('button',{name:'下一页项目'}).click();
   }
   assert.equal(seen.size,19,'all projects remain reachable through pagination in a short window');
   await page.getByRole('searchbox',{name:'搜索项目'}).fill('项目 18');await page.locator('#projects').getByText('项目 18',{exact:true}).waitFor();
   await page.getByRole('searchbox',{name:'搜索项目'}).fill('');
   const collapsedCount=await page.locator('#projects button').count();
   await page.locator('.monitor-details summary').click();
   await page.waitForFunction(()=>{const el=document.querySelector('#projects');return el.scrollHeight<=el.clientHeight+1;});
   assert.ok(await page.locator('#projects button').count()<=collapsedCount,'expanded resource details reduce the page size');
   await page.locator('.monitor-details summary').click();
   await page.locator('.sidebar [data-action="new-project"]').click();await page.locator('#project-name').waitFor();await page.keyboard.press('Escape');
   await page.locator('[data-action="settings"]').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
   for(const theme of ['light','dark']){await page.locator(`[data-theme-choice="${theme}"]`).first().click();await page.locator('.sidebar').evaluate(el=>el.scrollTop=0);await page.screenshot({path:`${out}/${viewport.width}x${viewport.height}-${theme}.png`});}
  }
  await page.setViewportSize({width:1280,height:900});await page.waitForFunction(()=>document.querySelectorAll('#projects button').length===6);
  assert.equal(await page.locator('#projects button').count(),6);await page.getByRole('button',{name:'下一页项目'}).click();await page.locator('#projects').getByText('项目 6',{exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索项目'}).fill('项目 18');assert.equal(await page.locator('#projects button').count(),1);await page.locator('#projects').getByText('项目 18',{exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索项目'}).fill('不存在');assert.equal(await page.locator('#projects button').count(),0);await page.getByRole('searchbox',{name:'搜索项目'}).fill('');
  many=true;await page.getByRole('button',{name:'任务列表',exact:true}).click();await page.getByText('共 26 项',{exact:true}).waitFor();assert.equal(await page.locator('.task-history-row').count(),10);
  await page.getByRole('button',{name:'下一页任务',exact:true}).click();assert.equal(await page.getByRole('button',{name:'任务第 2 页',exact:true}).getAttribute('aria-current'),'page');
  await page.locator('[data-task-filter="failed"]').click();assert.equal(await page.locator('.task-history-row').count(),4);assert.equal(await page.locator('.task-history-row .task-state--failed').count(),4);assert.equal(await page.locator('.task-result pre').first().isVisible(),false);await page.locator('.task-result summary').first().click();assert.equal(await page.locator('.task-result pre').first().isVisible(),true);
  await page.getByRole('searchbox',{name:'搜索任务'}).fill('没有');assert.equal(await page.locator('.task-history-row').count(),0);await page.getByText('没有符合条件的任务。',{exact:true}).waitFor();await page.getByRole('searchbox',{name:'搜索任务'}).fill('钢琴');await page.waitForTimeout(1800);assert.equal(await page.getByRole('searchbox',{name:'搜索任务'}).inputValue(),'钢琴');
  await page.locator('[data-task-filter="all"]').click();await page.getByRole('combobox',{name:'每页任务数'}).selectOption('20');assert.equal(await page.locator('.task-history-row').count(),20);await page.getByRole('combobox',{name:'每页任务数'}).selectOption('10');await page.getByRole('button',{name:'下一页任务',exact:true}).click();await page.locator('[data-theme-choice="dark"]').first().click();await mkdir('test-results/task-history',{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/task-history/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.querySelector('#task-history').scrollIntoView());await page.screenshot({path:'test-results/task-history/mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
