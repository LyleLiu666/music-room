import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioDraftStorage} from './drafts.ts';

function fixture(){
 const data=new Map<string,string>();let fail=false,queue=Promise.resolve();
 const storage={get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(fail)throw new Error('quota');data.set(key,value);}};
 const lock=<T>(action:()=>T):Promise<T>=>{const task=queue.then(action);queue=task.then(()=>{},()=>{});return task;};
 const open=()=>new StudioDraftStorage(storage,'workspace',lock);
 return {data,open,fail:(value:boolean)=>{fail=value;}};
}
test('drafts from different windows and sounds survive concurrent saves and stale navigation',async()=>{
 const f=fixture(),a=f.open(),b=f.open(),da=a.load(),db=b.load();
 da.one={soundId:'one',text:'甲'};db.two={soundId:'two',text:'乙'};
 assert.deepEqual(await Promise.all([a.save(da),b.save(db)]),[[],[]]);
 await a.save(da);await b.save(db);
 assert.deepEqual(f.open().load(),{one:da.one,two:db.two});
});
test('same-sound concurrent edits require an explicit choice without destroying either input',async()=>{
 const f=fixture(),a=f.open(),b=f.open(),da=a.load(),db=b.load();
 da.one={soundId:'one',text:'甲'};db.one={soundId:'one',text:'乙'};
 const [first,second]=await Promise.all([a.save(da),b.save(db)]);assert.deepEqual(first,[]);assert.deepEqual(second,['one']);
 assert.equal(db.one.text,'乙');assert.equal(f.open().load().one.text,'甲');
 await b.resolve(db,'one','local');assert.equal(f.open().load().one.text,'乙');
 da.one.text='甲再次编辑';assert.deepEqual(await a.save(da),['one']);
 await a.resolve(da,'one','saved');assert.equal(da.one.text,'乙');assert.equal(a.hasUnsaved(da),false);
});
test('quota failure remains unsaved and retry persists the latest input',async()=>{
 const f=fixture(),a=f.open(),drafts=a.load();drafts.one={soundId:'one',text:'保留'};
 f.fail(true);await assert.rejects(a.save(drafts),/quota/);assert.ok(a.hasUnsaved(drafts));
 f.fail(false);drafts.one.text='继续编辑';await a.save(drafts);assert.equal(a.hasUnsaved(drafts),false);assert.equal(f.open().load().one.text,'继续编辑');
});
test('legacy drafts migrate once; stale legacy data cannot replace newer per-sound records',async()=>{
 const f=fixture(),legacy={one:{soundId:'one',text:'旧稿'}},a=f.open(),drafts=a.load(legacy);
 await a.save(drafts);drafts.one.text='新稿';await a.save(drafts);
 assert.equal(f.open().load(legacy).one.text,'新稿');assert.equal(legacy.one.text,'旧稿');
});
