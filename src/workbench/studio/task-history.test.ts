import test from 'node:test';import assert from 'node:assert/strict';
import {taskHistoryRows,projectMatches,taskHistorySlice} from './task-history.ts';
test('completed history remains available while idle and links to the exact version',()=>{
 const library={sounds:[{id:'s',projectId:'p',title:'钢琴'}],projects:[{id:'p',title:'音乐'}],taskHistory:[{id:'v1',soundId:'s',number:1,state:'succeeded',stage:'完成',createdAt:'2026-10-20',hasAudio:true},{id:'v2',soundId:'s',number:2,state:'failed',stage:'导出失败',createdAt:'2026-10-21',hasAudio:false}]} as any;
 const html=taskHistoryRows(library);assert.match(html,/查看生成结果/);assert.match(html,/data-id="v1"/);assert.match(html,/data-action="task-version"/);assert.match(html,/失败/);assert.ok(html.indexOf('v2')<html.indexOf('v1'));
 assert.match(html,/<button[^>]*class="task-title-link"[^>]*data-id="v1"[^>]*>钢琴 · V1<\/button>/);
});
test('project navigation lists every project and searches names case-insensitively',()=>{
 const projects=Array.from({length:19},(_,i)=>({title:`Project ${i}`}));
 assert.equal(projectMatches(projects,'').length,19);assert.equal(projectMatches(projects,'  ').length,19);
 assert.deepEqual(projectMatches(projects,'PROJECT 18').map(p=>p.title),['Project 18']);assert.equal(projectMatches(projects,'project 1').length,10);
 assert.equal(projectMatches(projects,'不存在').length,0);
});
test('task pagination filters by explicit status and search without leaking other pages',()=>{
 const library={sounds:[{id:'s',projectId:'p',title:'钢琴'}],projects:[{id:'p',title:'音乐'}],taskHistory:Array.from({length:23},(_,i)=>({id:'v'+i,soundId:'s',number:i,state:i===0?'running':i===1?'queued':'failed',stage:'failed',error:'long error',createdAt:new Date(i*1000).toISOString(),hasAudio:false}))} as any;
 const first=taskHistorySlice(library,{page:1});assert.equal(first.rows.length,10);assert.equal(first.rows[0].state,'running');assert.equal(first.pages,3);
 assert.equal(taskHistorySlice(library,{page:99}).page,3);assert.equal(taskHistorySlice(library,{state:'queued'}).total,1);assert.equal(taskHistorySlice(library,{query:'不存在'}).total,0);
 const html=taskHistoryRows(library);assert.match(html,/task-state--running/);assert.match(html,/task-state--queued/);assert.match(html,/<details/);assert.equal((html.match(/class="task-history-row"/g)||[]).length,10);
});

test('history offers playback only for audio and parameter reuse only for stored generation inputs',()=>{
 const base={id:'v',soundId:'s',number:1,state:'succeeded',stage:'done',createdAt:'2026-11-07',hasAudio:true};
 const library={projects:[{id:'p',title:'项目'}],sounds:[{id:'s',projectId:'p',title:'旁白'}],taskHistory:[base],versions:[{...base,source:{kind:'speech'},input:{text:'正文'}}]} as any;
 assert.match(taskHistoryRows(library),/data-action="task-listen"/);assert.match(taskHistoryRows(library),/data-action="task-reuse"/);
 library.taskHistory[0].hasAudio=false;library.versions[0].input=undefined;
 assert.doesNotMatch(taskHistoryRows(library),/data-action="task-listen"|data-action="task-reuse"/);
});
test('effect history can reuse its saved prompt while imported recordings without a prompt cannot',()=>{
 const base={id:'v',soundId:'s',number:1,state:'succeeded',stage:'done',createdAt:'2026-11-08',hasAudio:true};
 const library={projects:[{id:'p',title:'项目'}],sounds:[{id:'s',projectId:'p',title:'音效',kind:'effect'}],taskHistory:[base],versions:[{...base,source:{kind:'sound-effect'},input:{text:'bubbling water',effectSeconds:3}}]} as any;
 assert.match(taskHistoryRows(library),/data-action="task-reuse"/);library.versions[0].source.kind='library';library.versions[0].input=undefined;assert.doesNotMatch(taskHistoryRows(library),/data-action="task-reuse"/);
});
