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

test('low physical free memory is not itself a refusal; compression and overlapping file counters never add startup capacity',async()=>{
 const {attachMemory}=await import('./telemetry.ts'),{admit}=await import('./policy.ts');
 const capacity=32*2**30,policy={reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8};
 const memory={capacity,free:256*2**20,purgeable:2*2**30,inactive:12*2**30,fileBacked:10*2**30,compressed:8*2**30,wired:3*2**30,swapUsed:4*2**30,swapInBytes:20*2**30,swapOutBytes:30*2**30};
 const h=attachMemory(parsePressure(capacity,'System-wide memory free percentage: 50%','1'),memory);
 assert.equal(admit(h,{verified:true,peak:{memory:8*2**30}},policy,Date.now()).allowed,true);
 const low=attachMemory(parsePressure(capacity,'System-wide memory free percentage: 10%','1'),{...memory,compressed:16*2**30});
 assert.equal(admit(low,{verified:true,peak:{memory:8*2**30}},policy,Date.now()).allowed,false);
 assert.equal(low.pools[0].available,Math.floor(capacity*.1));assert.equal(low.memory?.compressed,16*2**30);
});

test('startup headroom counts the application process tree, including model children, instead of only the server',async()=>{
 const {applicationFootprint}=await import('./telemetry.ts');const measured:number[]=[];
 const bytes=await applicationFootprint(async pid=>{measured.push(pid);return pid===10?100:400;},async()=> '10 0 S\n11 10 S\n12 11 S\n13 10 Z\n20 0 S',10);
 assert.deepEqual(bytes,{total:900,service:100});assert.deepEqual(measured.sort((a,b)=>a-b),[10,11,12]);
 await assert.rejects(applicationFootprint(async()=>1,async()=> 'bad',10),/进程列表/);
});

test('model monitoring queries only owned OS process groups, excluding unrelated process churn',async()=>{
 const calls:{args:string[];timeout:number}[]=[];
 const ids=await processGroupPids([10,20,10],async(_command,args,timeout)=>{calls.push({args,timeout});assert.deepEqual(args,['-g','10,20','-p','10,20','-o','pid=,pgid=,stat=']);return '10 10 S\n11 10 S\n20 20 S\n21 20 Z\n';});
 assert.deepEqual(ids,[10,11,20]);assert.equal(calls.length,1);
 assert.deepEqual(await processGroupPids([],async()=>{throw Error('no global process scan before model workers exist');}),[]);
});

test('an empty owned group is distinct from an unavailable process query',async()=>{
 const empty=Object.assign(Error('no selected processes'),{code:1,stdout:'',stderr:''});assert.deepEqual(await processGroupPids([10],async()=>{throw empty;}),[]);
 for(const error of [Object.assign(Error('denied'),{code:1,stdout:'',stderr:'permission denied'}),Object.assign(Error('partial'),{code:1,stdout:'10 10 S',stderr:''})])await assert.rejects(processGroupPids([10],async()=>{throw error;}));
 for(const groups of [[0],[-1],[NaN],[1.5]])await assert.rejects(processGroupPids(groups,async()=> '10 10 S'));
});

test('native BSD group selection measures the supervisor and inherited child but excludes another group',{skip:process.platform!=='darwin',timeout:10000},async()=>{
 const {spawn}=await import('node:child_process');
 const owned=spawn(process.execPath,['-e',"const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000);"],{detached:true,stdio:['ignore','pipe','ignore']});
 const foreign=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 const closed=[new Promise(resolve=>owned.once('close',resolve)),new Promise(resolve=>foreign.once('close',resolve))];
 try{
  assert.ok(owned.pid&&foreign.pid);
  const child=await new Promise<number>((resolve,reject)=>{let text='';owned.stdout!.on('data',bytes=>{text+=bytes;const line=text.split('\n')[0];if(/^\d+$/.test(line))resolve(Number(line));});owned.once('error',reject);});
  for(let n=0;n<5;n++){const pids=await processGroupPids([owned.pid]);assert.ok(pids.includes(owned.pid));assert.ok(pids.includes(child));assert.ok(!pids.includes(foreign.pid));}
 }finally{
  for(const process of [owned,foreign])if(process.pid)try{globalThis.process.kill(-process.pid,'SIGTERM');}catch(error:any){if(error.code!=='ESRCH')throw error;}
  await Promise.all(closed);
 }
});

test('a directly tracked worker is included when its PID is not a process group leader',async()=>{
 const ids=await processGroupPids([12],async()=> '12 1 S\n13 1 S\n');
 assert.deepEqual(ids,[12]);
});

test('native BSD selection includes a directly spawned worker without counting its parent group',{skip:process.platform!=='darwin',timeout:10000},async()=>{
 const {spawn}=await import('node:child_process');
 const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const closed=new Promise(resolve=>worker.once('close',resolve));
 try{assert.ok(worker.pid);assert.deepEqual(await processGroupPids([worker.pid]),[worker.pid]);}
 finally{worker.kill('SIGTERM');await closed;}
});

test('a worker exiting between selection and footprint sampling does not become a telemetry failure',async()=>{
 const {measureLivingProcess}=await import('./telemetry.ts');const denied=Object.assign(Error('proc_pid_rusage: Operation not permitted'),{code:1});
 assert.equal(await measureLivingProcess(process.pid,async()=>{throw denied;},async()=> 'Z'),0);
 assert.equal(await measureLivingProcess(process.pid,async()=>{throw denied;},async()=>{throw Object.assign(Error('exited'),{code:1,stdout:'',stderr:''});}),0);
 await assert.rejects(measureLivingProcess(process.pid,async()=>{throw denied;},async()=> 'S'),error=>error===denied);
 await assert.rejects(measureLivingProcess(process.pid,async()=>{throw denied;},async()=>{throw Error('state query unavailable');}));
 await assert.rejects(measureLivingProcess(process.pid,async()=>{throw denied;},async()=> ''),/进程状态/);
});
