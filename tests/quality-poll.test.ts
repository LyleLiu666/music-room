import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForRealJob} from './quality/poll.ts';

test('real-model polling checks completion after wake before applying an elapsed deadline',async()=>{
 let clock=0,reads=0;const events:string[]=[];
 const result=await waitForRealJob({get:async()=>({state:++reads===2?'succeeded':'running'}),terminal:v=>v.state==='succeeded',now:async()=>clock,timeoutMs:100,intervalMs:1,pause:async()=>{clock+=10000;},cancel:async()=>{events.push('cancel');}});
 assert.equal(result.state,'succeeded');assert.deepEqual(events,[]);
});

test('a stalled real job is cancelled and settled before polling rejects',async()=>{
 let awake=0,cancelled=false,reads=0;const order:string[]=[];
 await assert.rejects(waitForRealJob({get:async()=>{assert.ok(++reads<=3,'wait must use the supplied clock');return {state:'running'};},terminal:()=>false,now:async()=>awake,timeoutMs:100,intervalMs:10,pause:async()=>{awake+=50;},cancel:async()=>{order.push('cancel');await Promise.resolve();cancelled=true;order.push('settled');}}),/real inference timed out/);
 assert.equal(reads,3);assert.equal(cancelled,true);assert.deepEqual(order,['cancel','settled']);
});

test('a wall-clock jump does not shorten the injected awake-time budget',async(t)=>{
 let awake=0,wall=0,reads=0;
 t.mock.method(Date,'now',()=>wall);
 const result=await waitForRealJob({get:async()=>({state:++reads===4?'succeeded':'running'}),terminal:v=>v.state==='succeeded',now:async()=>awake,timeoutMs:100,intervalMs:10,pause:async()=>{awake+=10;wall+=3600000;},cancel:async()=>{throw Error('must not cancel');}});
 assert.equal(result.state,'succeeded');assert.equal(wall,10800000);
});

test('a transport or clock error also settles the owned task and preserves a cleanup failure',async()=>{
 const failure=Error('transport lost');let cancelled=0;
 await assert.rejects(waitForRealJob({get:async()=>{throw failure;},terminal:()=>false,now:async()=>0,timeoutMs:100,intervalMs:1,cancel:async()=>{cancelled++;}}),error=>error===failure);
 assert.equal(cancelled,1);
 await assert.rejects(waitForRealJob({get:async()=>{throw failure;},terminal:()=>false,now:async()=>0,timeoutMs:100,intervalMs:1,cancel:async()=>{throw Error('cancel failed');}}),error=>error instanceof AggregateError&&error.errors[0]===failure&&error.errors[1].message==='cancel failed');
});
