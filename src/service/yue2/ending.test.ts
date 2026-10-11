import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generationWithEnding,readTruncation} from './ending.ts';

test('natural ending guides music without changing lyrics or interpreting user keywords',()=>{
 const lyrics='[Verse]\n不要结束这场梦\n[Outro]\n明天见';
 const input={style:'温柔女声',lyrics,instrumental:false};
 const result=generationWithEnding(input);
 assert.ok(result.style.startsWith(input.style));
 assert.match(result.style,/outro/);assert.match(result.style,/decay/);
 assert.equal(result.lyrics,lyrics);assert.equal(input.style,'温柔女声');
 assert.deepEqual(generationWithEnding({...input,ending:'as-described'}),{style:input.style,lyrics});
 const instrumental=generationWithEnding({style:'钢琴',lyrics:'[instrumental]',instrumental:true});
 assert.match(instrumental.lyrics,/\[outro\]/);
 const structure='[intro]\n[bridge]\n[outro]';
 assert.equal(generationWithEnding({style:'钢琴',lyrics:structure,instrumental:true}).lyrics,structure);
});

test('truncation comes from saved generation evidence; missing, malformed or linked summaries stay unknown',async t=>{
 const root=await mkdtemp(join(tmpdir(),'music-ending-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'summary.json');assert.equal(readTruncation(path),undefined);
 await writeFile(path,JSON.stringify({truncated:{abc:false,semantic:true}}));
 assert.deepEqual(readTruncation(path),{abc:false,semantic:true});
 await writeFile(path,JSON.stringify({truncated:{abc:false,semantic:false}}));
 assert.deepEqual(readTruncation(path),{abc:false,semantic:false});
 for(const value of ['broken','{}','{"truncated":{"abc":"false","semantic":false}}','{"truncated":{"abc":false}}',' '.repeat(65537)]){
  await writeFile(path,value);assert.equal(readTruncation(path),undefined);
 }
 await rm(path);const other=join(root,'other.json');await writeFile(other,'{"truncated":{"abc":true,"semantic":true}}');await symlink(other,path);assert.equal(readTruncation(path),undefined);
});
