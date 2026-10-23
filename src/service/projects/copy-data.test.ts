import test from 'node:test';
import assert from 'node:assert/strict';
import {copyPlainData} from './copy-data.ts';

test('transaction copies isolate nested state and preserve explicit undefined fields',()=>{
 const original={versions:[{id:'v1',error:undefined,input:{text:'原稿'},resource:{demand:{peak:{memory:128}}}}],pending:undefined};
 const copied=copyPlainData(original);
 copied.versions[0].input.text='改稿';copied.versions[0].resource.demand.peak.memory=256;copied.versions.push({...copied.versions[0],id:'v2'});
 assert.equal(original.versions.length,1);assert.equal(original.versions[0].input.text,'原稿');assert.equal(original.versions[0].resource.demand.peak.memory,128);
 assert.equal(Object.hasOwn(copied,'pending'),true);assert.equal(Object.hasOwn(copied.versions[0],'error'),true);
 assert.deepEqual(copyPlainData([undefined,null,0,false,'']),[undefined,null,0,false,'']);assert.equal(copyPlainData(undefined),undefined);
});

test('record keys cannot change prototypes and native leaves retain their types and isolation',()=>{
 const original=JSON.parse('{"__proto__":{"polluted":true},"nested":[{"value":1}]}');
 const copied=copyPlainData(original);copied.nested[0].value=2;
 assert.equal(Object.getPrototypeOf(copied),Object.prototype);assert.equal(Object.hasOwn(copied,'__proto__'),true);assert.equal(({} as Record<string,unknown>).polluted,undefined);assert.equal(original.nested[0].value,1);
 for(const value of [new Date(),new Map([['x',1]]),new Set([1]),new Uint8Array([1,2]),new Error('x')]){
  const copied=copyPlainData({nested:value});assert.deepEqual(copied,structuredClone({nested:value}));assert.notEqual(copied.nested,value);
 }
 const binary=new Uint8Array([1,2]);copyPlainData({audio:binary}).audio[0]=9;assert.equal(binary[0],1);
});
