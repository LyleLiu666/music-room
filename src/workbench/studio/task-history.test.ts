import test from 'node:test';import assert from 'node:assert/strict';
import {taskHistoryRows,projectPage} from './task-history.ts';
test('completed history remains available while idle and links to the exact version',()=>{
 const library={sounds:[{id:'s',projectId:'p',title:'钢琴'}],projects:[{id:'p',title:'音乐'}],taskHistory:[{id:'v1',soundId:'s',number:1,state:'succeeded',stage:'完成',createdAt:'2026-10-20',hasAudio:true},{id:'v2',soundId:'s',number:2,state:'failed',stage:'导出失败',createdAt:'2026-10-21',hasAudio:false}]} as any;
 const html=taskHistoryRows(library);assert.match(html,/查看生成结果/);assert.match(html,/data-id="v1"/);assert.match(html,/data-action="task-version"/);assert.match(html,/失败/);assert.ok(html.indexOf('v2')<html.indexOf('v1'));
});
test('project navigation searches names and clamps pages after filtering or deletion',()=>{
 const projects=Array.from({length:19},(_,i)=>({title:`Project ${i}`}));
 assert.equal(projectPage(projects,'',2).items.length,6);assert.equal(projectPage(projects,'',4).items.length,1);
 assert.equal(projectPage(projects,'project 18',3).page,1);assert.equal(projectPage(projects,'PROJECT 18',1).items[0].title,'Project 18');
 assert.equal(projectPage(projects,'不存在',5).total,0);assert.equal(projectPage(projects,'不存在',5).page,1);
});
