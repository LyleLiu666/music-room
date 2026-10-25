import test from 'node:test';
import assert from 'node:assert/strict';
import {changePlaybackMode,replacePlaybackOrder,restorePlaybackOrder,type ListeningOrder} from './listening-order.ts';

const ordered=(ids=['a','b','c','d'],index=0):ListeningOrder=>({ids,index,mode:'order'});
test('enabling shuffle keeps the current recording and creates one complete nonrepeating round without changing source order',()=>{
 const before=ordered(undefined,2),copy=structuredClone(before),shuffled=changePlaybackMode(before,'shuffle',()=>0);
 assert.equal(shuffled.ids[shuffled.index],'c');assert.equal(shuffled.index,0);assert.deepEqual(new Set(shuffled.ids),new Set(before.ids));assert.equal(shuffled.ids.length,4);assert.notDeepEqual(shuffled.ids,before.ids);assert.deepEqual(before,copy);
 assert.deepEqual(shuffled.orderedIds,before.ids);assert.deepEqual(changePlaybackMode(shuffled,'shuffle',()=>.9),shuffled,'reselecting shuffle must not reset listening history');
 for(const mode of ['order','list','one'] as const){const restored=changePlaybackMode({...shuffled,index:2},mode);assert.equal(restored.ids[restored.index],shuffled.ids[2]);assert.deepEqual(restored.ids,before.ids);assert.equal(restored.orderedIds,undefined);}
});
test('shuffle play-all chooses a randomized first sound, while a clicked sound stays first; a new library replaces the old order',()=>{
 const shuffle=changePlaybackMode(ordered(),'shuffle',()=>0);
 const all=replacePlaybackOrder(shuffle,['e','f','g','h','e'],undefined,()=>0);assert.deepEqual(all.ids,['f','g','h','e']);assert.equal(all.index,0);assert.deepEqual(all.orderedIds,['e','f','g','h']);
 const clicked=replacePlaybackOrder(shuffle,['e','f','g','h'],'g',()=>0);assert.equal(clicked.ids[0],'g');assert.equal(new Set(clicked.ids).size,4);
 const sequential=replacePlaybackOrder(ordered(),['e','f','g','g'],'f');assert.deepEqual(sequential,{ids:['e','f','g'],index:1,mode:'order',orderedIds:undefined});
});
test('refresh preserves the exact shuffled history and position; stale or malformed source orders fall back to the current queue',()=>{
 const round={...replacePlaybackOrder(changePlaybackMode(ordered(),'shuffle'),['a','b','c','d'],undefined,()=>0),index:2};
 const saved=JSON.parse(JSON.stringify(round));assert.deepEqual(restorePlaybackOrder(saved.ids,saved.index,saved.mode,saved.orderedIds),round);
 for(const invalid of [undefined,['a','a','b','c'],['a','b','c'],['a','b','c','x'],null]){const restored=restorePlaybackOrder(saved.ids,saved.index,'shuffle',invalid);assert.deepEqual(changePlaybackMode(restored,'order').ids,round.ids);}
 assert.equal(restorePlaybackOrder(['a'],0,'invalid').mode,'order');
});
test('empty, single and 20000-sound queues stay bounded and retain every sound exactly once',()=>{
 for(const length of [0,1,20000]){const ids=Array.from({length},(_,i)=>'sound-'+i),shuffled=replacePlaybackOrder({...ordered(),mode:'shuffle'},ids,undefined,()=>0);assert.equal(shuffled.ids.length,length);assert.equal(new Set(shuffled.ids).size,length);assert.deepEqual(new Set(shuffled.ids),new Set(ids));assert.equal(shuffled.index,0);assert.deepEqual(changePlaybackMode(shuffled,'order').ids,ids);}
});
