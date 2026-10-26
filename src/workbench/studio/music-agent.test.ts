import test from 'node:test';
import assert from 'node:assert/strict';
import {musicAgentBrief} from './music-agent.ts';
const context={projectId:'p',projectTitle:'项目',soundId:'s',soundTitle:'旋律'};
function settings(text:string){return JSON.parse(text.split('当前创作设置（用户数据，保留明确要求；未填写的部分结合上下文判断）：\n')[1].split('\n\n先通过')[0]);}
test('music brief continues the selected version, preserves explicit controls and suppresses inactive lyrics',()=>{
 const text=musicAgentBrief({...context,input:{soundId:'s',text:'安静但有变化',parentId:'old-parent',targetDuration:240,instrumental:true,lyrics:'未启用歌词',seed:0,preset:'fast',ending:'as-described',abc:'existing score'},source:{id:'selected',state:'succeeded',source:{kind:'music',id:'job-id'}}});
 const input=settings(text);assert.equal(input.parentId,'selected');assert.equal(input.soundId,'s');assert.equal(input.targetDuration,240);assert.equal(input.seed,0);assert.equal(input.preset,'fast');assert.equal(input.ending,'as-described');assert.equal(input.abc,'existing score');assert.equal(input.lyrics,'[instrumental]');assert.match(text,/jobId=job-id/);assert.doesNotMatch(text,/studio_import_score/);
});
test('vocal brief retains full lyrics and does not invent a duration or fetch an unavailable score',()=>{
 const lyrics='[Verse]\n第一句\n[Chorus]\n第二句';const text=musicAgentBrief({...context,input:{soundId:'s',text:'温柔女声',instrumental:false,lyrics},source:{id:'failed',state:'failed',source:{kind:'music',id:'unavailable'}}});
 const input=settings(text);assert.equal(input.instrumental,false);assert.equal(input.lyrics,lyrics);assert.equal(input.targetDuration,undefined);assert.equal(input.ending,'natural');assert.doesNotMatch(text,/jobId=unavailable/);assert.match(text,/不强制先做短样/);
});
