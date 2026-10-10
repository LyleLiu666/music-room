import test from 'node:test';import assert from 'node:assert/strict';
import {plan,weights,mix,SR} from './audio.ts';
test('chunk overlaps cover the entire timeline once, including short final phrases',()=>{for(const n of [1,SR,16*SR,17*SR,211*SR+129]){const p=plan(n),sum=new Float32Array(n);p.forEach((part,i)=>{const w=weights(p,i);w.forEach((x,j)=>sum[part.start+j]+=x);assert.ok(part.inputEnd-part.inputStart<=19*SR);});assert.ok(sum.every(x=>Math.abs(x-1)<1e-6));assert.equal(p.at(-1)!.end,n);}});
test('remix preserves stereo background and full duration with silence in converted vocals',()=>{const n=SR*2,left=Float32Array.from({length:n},(_,i)=>Math.sin(i*.1)*.2),right=Float32Array.from({length:n},(_,i)=>Math.cos(i*.07)*.3);const result=mix([left,right],new Float32Array(n));assert.equal(result.channels.length,2);assert.equal(result.channels[0].length,n);assert.equal(result.channels[0][SR],left[SR]);assert.equal(result.channels[1][SR],right[SR]);assert.equal(result.channels[0][n-1],0);});
test('remix attenuates both channels together and rejects truncation',()=>{const result=mix([new Float32Array(SR).fill(.8),new Float32Array(SR).fill(.4)],new Float32Array(SR).fill(.8));assert.ok(result.gain<1);assert.ok(result.channels.every(a=>a.every(x=>Number.isFinite(x)&&Math.abs(x)<=.981)));assert.throws(()=>mix([new Float32Array(2)],new Float32Array(1)));});

test('native small tail rounding is padded but unexpected truncation is rejected', async()=>{
  const {fitLength}=await import('./audio.ts');
  assert.deepEqual([...fitLength(new Float32Array([.5]),3)],[.5,0,0]);
  assert.throws(()=>fitLength(new Float32Array(1),2048),/长度异常/);
});
test('source gate suppresses generated vocals in silent passages without silencing loud singing',async()=>{
  const {gate}=await import('./audio.ts');
  const source=new Float32Array(SR),silent=new Float32Array(SR).fill(.5);gate(source,silent);assert.ok(silent.every(x=>x===0));
  source.fill(.1);const singing=new Float32Array(SR).fill(.5);gate(source,singing);assert.ok(singing.every(x=>x===.5));
});
