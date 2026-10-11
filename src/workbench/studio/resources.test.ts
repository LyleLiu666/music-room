import test from 'node:test';import assert from 'node:assert/strict';import {resourcePanel,resourceFailure} from './resources.ts';import {testResources} from '../../service/resources/testing.ts';
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
test('resource panel distinguishes capacity, estimates, task samples and absent telemetry',async()=>{
 const c=testResources();let s=c.snapshot();assert.match(resourcePanel(s),/暂时无法读取/);s=await c.status();const html=resourcePanel(s);assert.match(html,/16.0 GiB/);assert.match(html,/应用上限 12.0 GiB/);assert.match(html,/可用估计/);assert.match(html,/当前没有重型任务/);c.pause();assert.match(resourcePanel(c.snapshot()),/恢复后续任务/);await c.close();
});
