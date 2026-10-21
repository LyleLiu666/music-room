import test from 'node:test';import assert from 'node:assert/strict';
import {taskHistoryRows,projectPage,taskHistorySlice} from './task-history.ts';
test('completed history remains available while idle and links to the exact version',()=>{
 const library={sounds:[{id:'s',projectId:'p',title:'钢琴'}],projects:[{id:'p',title:'音乐'}],taskHistory:[{id:'v1',soundId:'s',number:1,state:'succeeded',stage:'完成',createdAt:'2026-10-20',hasAudio:true},{id:'v2',soundId:'s',number:2,state:'failed',stage:'导出失败',createdAt:'2026-10-21',hasAudio:false}]} as any;
 const html=taskHistoryRows(library);assert.match(html,/查看生成结果/);assert.match(html,/data-id="v1"/);assert.match(html,/data-action="task-version"/);assert.match(html,/失败/);assert.ok(html.indexOf('v2')<html.indexOf('v1'));
 assert.match(html,/<button[^>]*class="task-title-link"[^>]*data-id="v1"[^>]*>钢琴 · V1<\/button>/);
});
test('project navigation searches names and clamps pages after filtering or deletion',()=>{
 const projects=Array.from({length:19},(_,i)=>({title:`Project ${i}`}));
 assert.equal(projectPage(projects,'',2).items.length,6);assert.equal(projectPage(projects,'',4).items.length,1);
 assert.equal(projectPage(projects,'project 18',3).page,1);assert.equal(projectPage(projects,'PROJECT 18',1).items[0].title,'Project 18');
 assert.equal(projectPage(projects,'不存在',5).total,0);assert.equal(projectPage(projects,'不存在',5).page,1);
});
test('task pagination filters by explicit status and search without leaking other pages',()=>{
 const library={sounds:[{id:'s',projectId:'p',title:'钢琴'}],projects:[{id:'p',title:'音乐'}],taskHistory:Array.from({length:23},(_,i)=>({id:'v'+i,soundId:'s',number:i,state:i===0?'running':i===1?'queued':'failed',stage:'failed',error:'long error',createdAt:new Date(i*1000).toISOString(),hasAudio:false}))} as any;
 const first=taskHistorySlice(library,{page:1});assert.equal(first.rows.length,10);assert.equal(first.rows[0].state,'running');assert.equal(first.pages,3);
 assert.equal(taskHistorySlice(library,{page:99}).page,3);assert.equal(taskHistorySlice(library,{state:'queued'}).total,1);assert.equal(taskHistorySlice(library,{query:'不存在'}).total,0);
 const html=taskHistoryRows(library);assert.match(html,/task-state--running/);assert.match(html,/task-state--queued/);assert.match(html,/<details/);assert.equal((html.match(/class="task-history-row"/g)||[]).length,10);
});
