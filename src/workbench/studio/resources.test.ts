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
 assert.match(html,/data-action="resource-release"  title="重型任务结束后会自动释放">释放空闲模型/);assert.match(html,/<table id="cpu"><\/table>/);assert.match(html,/role="img" aria-label="[^"]*内存分布：本程序/);
 const summaryOnly=html.split('<details class="resource-details">')[0];
 assert.match(summaryOnly,/class="memory-legend"/);assert.match(summaryOnly,/系统保留额度 <b>4\.0 GiB<\/b>/);assert.match(summaryOnly,/本程序 <b>1\.0 GiB<\/b>（后台服务）/);assert.match(summaryOnly,/各功能内存需求/);assert.match(summaryOnly,/音乐 · YuE2/);assert.match(summaryOnly,/8\.0 GiB/);
 assert.equal(memoryLimitSummary(s),'当前应用上限 12.0 GiB（自动管理）');
 const widths=[...html.matchAll(/style="width:([0-9.]+)%"/g)].map(m=>Number(m[1]));assert.equal(widths.length,3);assert.ok(Math.abs(widths.reduce((a,b)=>a+b,0)-100)<0.1);
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
test('resource overview attributes active task usage and marks capability readiness against current budget',()=>{
 const status={
  paused:false,queued:[],history:[],residents:[{engine:'yue2',loaded:true,estimatedBytes:undefined}],
  configurationError:undefined,hardwareError:undefined,fault:undefined,
  policy:{reserveFraction:.3,reserveMinimum:2*2**30,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:60000,retryMs:1000,maxQueue:64},
  hardware:{supported:true,topology:'unified' as const,sampledAt:Date.now(),pressure:'normal' as const,serviceOwned:256*2**20,pools:[{id:'memory',capacity:32*2**30,available:8*2**30,owned:6*2**30}]},
  active:{id:'m1',engine:'yue2',stage:'running' as const,submittedAt:0,demand:{verified:true,startup:{memory:8*2**30},peak:{memory:8*2**30}}},
  observation:{usage:{memory:5.5*2**30},pressure:'normal' as const},
  reservations:{memory:8*2**30}
 };
 const summaryOnly=resourceOverview(status).split('<details class="resource-details">')[0];
 assert.match(summaryOnly,/正在运行：音乐 5\.5 GiB/);
 assert.match(summaryOnly,/还差 1\.0 GiB/);
 const waiting=resourceOverview({...status,active:{...status.active,stage:'waiting_resources'},reservations:{}});
 assert.match(waiting,/等待资源：音乐/);
 assert.doesNotMatch(waiting,/正在运行：音乐|5\.5 GiB|当前任务采样/);
 assert.match(summaryOnly,/内存充足/);
 for(const [stage,label] of [['loading','加载中'],['cancelling','正在取消']] as const){
  assert.match(resourceOverview({...status,active:{...status.active,stage}}),new RegExp(`${label}：音乐 5\\.5 GiB`));
 }
});

test('capability guide distinguishes lost, stale and unsupported hardware from sufficient memory',async()=>{
 const coordinator=testResources();
 try{
  const status=await coordinator.status(),hardware=status.hardware!;
  const offline=resourceOverview(status,'',true);
  assert.doesNotMatch(offline,/新任务可用|可运行|内存充足|达到起步要求/);
  assert.match(offline,/暂时无法读取电脑资源/);
  assert.match(offline,/音乐 · YuE2<\/span>.*状态未知/);
  const unsupported=resourceOverview({...status,hardware:{...hardware,supported:false}});
  assert.match(unsupported,/设备不支持/);
  assert.doesNotMatch(unsupported,/可运行|内存充足|达到起步要求/);
  for(const sample of [{...hardware,pressure:'unknown' as const},{...hardware,sampledAt:0}]){
   const html=resourceOverview({...status,hardware:sample});
   assert.match(html,/状态未知/);
   assert.doesNotMatch(html,/新任务可用|内存分布：|等待压力恢复|可运行|达到起步要求/);
  }
  const critical=resourceOverview({...status,hardware:{...hardware,pressure:'critical'}});
  assert.match(critical,/等待压力恢复/);
  assert.doesNotMatch(critical,/新任务可用/);
  assert.match(resourceOverview(status),/音乐 · YuE2<\/span>.*8\.0 GiB 起.*达到起步要求/);
 }finally{await coordinator.close();}
});

test('physical memory distribution stays within capacity when the application occupies the system reserve',async()=>{
 const coordinator=testResources();
 try{
  const status=await coordinator.status(),hardware=status.hardware!,pool=hardware.pools[0];
  const html=resourceOverview({...status,hardware:{...hardware,pools:[{...pool,owned:15*2**30}]}});
  const widths=[...html.matchAll(/style="width:([0-9.]+)%"/g)].map(m=>Number(m[1]));
  assert.ok(Math.abs(widths.reduce((a,b)=>a+b,0)-100)<0.1);
  assert.match(html,/内存分布：本程序 15\.0 GiB，[^"]*系统可用估计 1\.0 GiB/);
  assert.doesNotMatch(html,/内存分布：[^"]*系统保留/);
 }finally{await coordinator.close();}
});
