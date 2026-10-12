import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundVisits} from './sound-navigation.ts';
test('entering a sound records recency, rerenders do not, leaving and returning does',()=>{
 const visits=new SoundVisits({a:10,b:20});
 visits.enter('a',30);visits.enter('a',40);
 assert.equal(visits.timestamps.a,30);
 visits.enter('',50);visits.enter('a',60);
 assert.equal(visits.timestamps.a,60);
 assert.deepEqual(visits.sort([{id:'b'},{id:'c'},{id:'a'}]).map(s=>s.id),['a','b','c']);
});
test('stored visits survive reload and fast visits remain ordered',()=>{
 const visits=new SoundVisits({a:100});visits.enter('b',100);
 const restored=new SoundVisits(JSON.parse(JSON.stringify(visits.timestamps)));
 assert.deepEqual(restored.sort([{id:'a'},{id:'b'}]).map(s=>s.id),['b','a']);
});
