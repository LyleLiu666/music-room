import test from 'node:test';import assert from 'node:assert/strict';import {resourceOverview,memoryLimitSummary,resourceFailure} from './resources.ts';import {testResources} from '../../service/resources/testing.ts';
test('memory failures explain recovery using structured reasons and keep diagnostics separate',()=>{
 const html=resourceFailure({reason:'PRESSURE_PROTECTION',message:'系统交换空间增长超过安全阈值，已停止任务'},true);
 assert.match(html,/为保护电脑，生成已停止/);assert.match(html,/关闭暂时不用的应用/);
 assert.match(html,/较快尝试/);assert.match(html,/查看内存状态/);assert.match(html,/<button class="primary" data-action="retry-generation">重试生成<\/button>/);assert.match(html,/修改要求/);
 assert.equal(html.split('系统交换空间增长超过安全阈值').length-1,1);
 assert.doesNotMatch(html,/修改后重试/);
 assert.doesNotMatch(resourceFailure({reason:'PRESSURE_PROTECTION'},false),/较快尝试/);
 assert.equal(resourceFailure({message:'系统交换空间增长超过安全阈值'},true),'');
 assert.match(resourceFailure({reason:'PEAK_EXCEEDED',message:'<script>'},false),/&lt;script&gt;/);
});
test('task budget failures do not imply system pressure or promise recovery by closing apps',()=>{
 const html=resourceFailure({reason:'PEAK_EXCEEDED',message:'任务实际占用超过内存预算，已停止'},true);
 assert.match(html,/任务占用超过已验证的内存预算/);
 assert.doesNotMatch(html,/关闭暂时不用的应用|待压力恢复正常/);
});
test('telemetry failures explain a monitoring problem and expose escaped diagnostics',()=>{
 const html=resourceFailure({reason:'RESOURCE_TELEMETRY_UNAVAILABLE',message:'无法读取内存',diagnostic:'vmmap <timeout>'},true);
 assert.match(html,/内存监测失败/);assert.match(html,/无需修改创作内容/);assert.match(html,/vmmap &lt;timeout&gt;/);
 assert.doesNotMatch(resourceFailure({reason:'PRESSURE_PROTECTION'},false,false),/retry-generation/);
});
test('resource overview distinguishes capacity, estimates, residents and absent telemetry',async()=>{
 assert.match(resourceOverview(undefined),/正在读取电脑资源/);assert.match(resourceOverview(undefined,'',true),/暂时无法读取电脑资源/);
 const c=testResources();let s=c.snapshot();assert.match(resourceOverview(s),/暂时无法读取/);assert.equal(memoryLimitSummary(s),'正在读取当前上限…');
 s=await c.status();const html=resourceOverview(s,'<table id="cpu"></table>');
 assert.match(html,/16.0 GiB/);assert.match(html,/应用上限 <b>12.0 GiB<\/b>（自动）/);assert.match(html,/系统可用估计/);assert.match(html,/已加载模型<\/span><span>无/);
 assert.match(html,/data-action="resource-release"  title="重型任务结束后会自动释放">释放空闲模型/);assert.match(html,/<table id="cpu"><\/table>/);assert.match(html,/role="img" aria-label="[^"]*内存分布：系统保留/);
 assert.equal(memoryLimitSummary(s),'当前应用上限 12.0 GiB（自动管理）');
 const widths=[...html.matchAll(/style="width:([0-9.]+)%"/g)].map(m=>Number(m[1]));assert.equal(widths.length,4);assert.ok(Math.abs(widths.reduce((a,b)=>a+b,0)-100)<0.1);
 await c.close();
});
test('unverified input failures show preflight advice and an obvious retry instead of implying model execution failed',()=>{
 const html=resourceFailure({reason:'RESOURCE_PROFILE_UNVERIFIED',message:'此模型配置的资源需求尚未验证'},false);
 assert.match(html,/生成前检查未通过/);assert.match(html,/8000 字/);assert.match(html,/长稿会自动分段/);assert.match(html,/<button class="primary" data-action="retry-generation">重试生成/);assert.doesNotMatch(html,/关闭暂时不用的应用/);
});
test('an unverified sound effect suggests checking its own duration rather than speech length',()=>{
 const html=resourceFailure({reason:'RESOURCE_PROFILE_UNVERIFIED'},false,false,undefined,true);
 assert.match(html,/音效|1–5 秒/);assert.doesNotMatch(html,/正文|长稿|8000/);
});

test('music recovery states the saved boundary instead of promising chunk-level continuation',()=>{
 for(const [stage,expected] of [['plan','音乐内容生成'],['semantic','声音合成'],['synthesis','音频导出']] as const){
  const html=resourceFailure({reason:'RESOURCE_TELEMETRY_UNAVAILABLE'},true,true,{jobId:'a'.repeat(32),stage});
  assert.match(html,/继续生成/);assert.ok(html.includes(expected));assert.doesNotMatch(html,/从头生成/);
 }
 assert.match(resourceFailure({reason:'RESOURCE_TELEMETRY_UNAVAILABLE'},true),/尚无可用恢复点/);
 assert.match(resourceFailure({reason:'RESOURCE_TELEMETRY_UNAVAILABLE'},true),/更换随机种子从头生成/);
});
test('resource overview tolerates partial status from older services without throwing',()=>{
 for(const status of [{queued:[],paused:false},{active:{id:'a',engine:'tts',stage:'running'},queued:[],paused:true},{queued:[],paused:false,hardware:{pressure:'normal',sampledAt:0,pools:[{id:'memory',capacity:1,available:1,owned:0}]}}] as any[]){
  const html=resourceOverview(status);assert.match(html,/本机资源/);assert.match(html,/已加载模型<\/span><span>无/);assert.equal(memoryLimitSummary(status),'正在读取当前上限…');
 }
});
