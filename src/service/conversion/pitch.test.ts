import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftBackingStem} from './pitch.ts';
const rate=44100;
const tone=(hz:number,seconds=2)=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>.3*Math.sin(2*Math.PI*hz*i/rate));
function frequency(a:Float32Array){let cycles=0;for(let i=rate/2;i<rate;i++)if(a[i]>=0&&a[i-1]<0)cycles++;return cycles*2;}
function rms(a:Float32Array){return Math.sqrt(a.reduce((sum,x)=>sum+x*x,0)/a.length);}
test('tonal backing shifts positive and negative semitones without changing stereo, duration or source',async()=>{
 for(const semitones of [-12,-3,3,12]){const input=[tone(220),tone(330)],before=input.map(a=>a.slice()),output=await shiftBackingStem('other',input,semitones);assert.equal(output.length,2);for(let c=0;c<2;c++){assert.equal(output[c].length,input[c].length);assert.deepEqual(input[c],before[c]);assert.ok(output[c].every(Number.isFinite));const expected=[220,330][c]*2**(semitones/12);assert.ok(Math.abs(frequency(output[c])-expected)<6,`${semitones}: expected ${expected}, got ${frequency(output[c])}`);assert.ok(rms(output[c].subarray(0,rate*.04))>.08);assert.ok(rms(output[c].subarray(-rate*.1))>.08);}}
});
test('drums and zero-shift bypass pitch processing exactly; bass is shifted',async()=>{const input=[tone(110),tone(220)];assert.equal(await shiftBackingStem('drums',input,12),input);assert.equal(await shiftBackingStem('bass',input,0),input);assert.ok(Math.abs(frequency((await shiftBackingStem('bass',input,12))[0])-220)<6);});
test('silent and short stems retain length, channels and finite samples; cancellation and invalid shift reject',async()=>{for(const seconds of [.03,.1]){const output=await shiftBackingStem('other',[tone(330,seconds)],12);assert.equal(output[0].length,Math.round(rate*seconds));assert.ok(output[0].some(x=>Math.abs(x)>.05));}const silent=await shiftBackingStem('bass',[new Float32Array(rate)],-12);assert.ok(silent[0].every(x=>x===0));for(const shift of [13,-13,.5,NaN])await assert.rejects(shiftBackingStem('bass',[tone(110)],shift));const controller=new AbortController();controller.abort();await assert.rejects(shiftBackingStem('other',[tone(330)],3,controller.signal));});
test('melodic phrase starts and endings stay within 25ms of the original drum timeline',async()=>{
 for(const shift of [-12,-3,3,12]){const input=Float32Array.from({length:rate*2},(_,i)=>(i>=rate*.4&&i<rate*.7||i>=rate*1.4&&i<rate*1.7)?.3*Math.sin(i*2*Math.PI*440/rate):0);const output=(await shiftBackingStem('other',[input],shift))[0];let onset=-1,tail=-1;for(let i=0;i<output.length;i++)if(Math.abs(output[i])>.05){if(onset<0)onset=i;tail=i;}assert.ok(Math.abs(onset/rate-.4)<.025,`shift ${shift} onset ${onset/rate}`);assert.ok(Math.abs(tail/rate-1.7)<.025,`shift ${shift} tail ${tail/rate}`);}
});
