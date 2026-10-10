import test from 'node:test';import assert from 'node:assert/strict';import {resourcePanel} from './resources.ts';import {testResources} from '../../service/resources/testing.ts';
test('resource panel distinguishes capacity, estimates, task samples and absent telemetry',async()=>{
 const c=testResources();let s=c.snapshot();assert.match(resourcePanel(s),/暂时无法读取/);s=await c.status();const html=resourcePanel(s);assert.match(html,/16.0 GiB/);assert.match(html,/应用上限 12.0 GiB/);assert.match(html,/可用估计/);assert.match(html,/当前没有重型任务/);c.pause();assert.match(resourcePanel(c.snapshot()),/恢复后续任务/);await c.close();
});
