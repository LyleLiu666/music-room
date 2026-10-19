import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePressure,parseFootprint,parseSwap,processGroupPids} from './telemetry.ts';
test('hardware reports actual topology, capacity, dynamic free amount and pressure without inventing defaults',()=>{
 for(const gib of [8,16,24,32,64]){const s=parsePressure(gib*2**30,'System-wide memory free percentage: 50%','1');assert.equal(s.pools.length,1);assert.equal(s.pools[0].available,gib*2**29);}
 assert.equal(parsePressure(8*2**30,'System-wide memory free percentage: 9%','4').pressure,'critical');
 assert.throws(()=>parsePressure(2**30,'missing','1'));assert.throws(()=>parsePressure(2**30,'System-wide memory free percentage: 101%','1'));assert.throws(()=>parsePressure(2**30,'System-wide memory free percentage: 10%','0'));
});
test('physical footprint excludes RSS and historical peak from current usage',()=>{
 assert.equal(parseFootprint('Physical footprint: 512.5M\nPhysical footprint (peak): 4G\nRSS: 10G'),512.5*2**20);assert.throws(()=>parseFootprint('RSS: 10G'));
});
test('swap occupancy is telemetry, never added to physical capacity',()=>{
 assert.equal(parseSwap('vm.swapusage: total = 4096.00M used = 2833.38M free = 1262.62M'),Math.ceil(2833.38*2**20));assert.throws(()=>parseSwap('used = unknown'));assert.throws(()=>parseSwap('used = -1M'));
});
test('monitoring reads all owned groups once and retries one transient process-query timeout',async()=>{
 const calls:number[]=[];const read=async(_command:string,_args:string[],timeout:number)=>{calls.push(timeout);if(calls.length===1)throw Object.assign(Error('timeout'),{killed:true});return '10 10 S\n11 10 S\n12 10 Z\n20 20 S\n21 20 S\n99 99 S\n';};
 assert.deepEqual(await processGroupPids([10,20],read),[10,11,20,21]);assert.deepEqual(calls,[2000,1000]);
 let count=0;await assert.rejects(processGroupPids([10],async()=>{count++;throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});}));assert.equal(count,2);
 count=0;await assert.rejects(processGroupPids([10],async()=>{count++;throw Object.assign(Error('permission'),{code:'EACCES'});}));assert.equal(count,1);
});

test('missing or malformed process snapshots fail closed instead of undercounting memory',async()=>{
 for(const output of ['', '12 invalid S', '12 10', 'bad 10 S', '12 10 S extra'])await assert.rejects(processGroupPids([10],async()=>output),/进程列表/);
});
