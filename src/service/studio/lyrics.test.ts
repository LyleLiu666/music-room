import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLyrics,lyricsLrc} from './lyrics.ts';
test('lyrics bind to the exact audio and retain repeated and extra performed lines',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lyrics-'));try{
 const v={id:'v9',audioPath:'/audio/9',input:{lyrics:'参考词'}};
 assert.equal(readLyrics(dir,v).kind,'plain');
 const document={format:'music-room-lyrics',version:1,versionId:'v9',audioPath:'/audio/9',duration:20,draft:true,lines:[{text:'重复句',start:2,end:4},{text:'重复句',start:6,end:8},{text:'新增段',start:12,end:15}]};
 writeFileSync(join(dir,'v9.json'),JSON.stringify(document));const result=readLyrics(dir,v);assert.equal(result.kind,'synced');assert.equal(result.lines.length,3);assert.match(lyricsLrc(result.lines),/\[00:12.00\]新增段/);
 assert.equal(readLyrics(dir,{...v,audioPath:'/audio/new'}).kind,'plain');
 document.lines[0].end=1;writeFileSync(join(dir,'v9.json'),JSON.stringify(document));assert.throws(()=>readLyrics(dir,v));
 assert.throws(()=>readLyrics(dir,{...v,id:'../outside'}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
