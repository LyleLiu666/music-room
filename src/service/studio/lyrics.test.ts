import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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

test('instrumental markers and stale vocal drafts are not reference lyrics',()=>{
 const dir=mkdtempSync(join(tmpdir(),'instrumental-lyrics-'));
 try{for(const lyrics of ['[instrumental]','这是旧歌词']){
  const result=readLyrics(dir,{id:'v1',input:{instrumental:true,lyrics}});
  assert.equal(result.kind,'none');assert.equal(result.reference,'');
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('explicit instrumental versions ignore even persisted or invalid lyric sidecars',()=>{
 const dir=mkdtempSync(join(tmpdir(),'instrumental-sidecar-'));
 try{
  const v={id:'v1',audioPath:'/audio/1',input:{instrumental:true,lyrics:'旧歌词'}};
  writeFileSync(join(dir,'v1.json'),JSON.stringify({format:'music-room-lyrics',version:1,versionId:'v1',audioPath:v.audioPath,duration:20,lines:[{text:'旧歌词',start:0,end:3}]}));
  assert.deepEqual(readLyrics(dir,v),{kind:'none',reference:'',lines:[],draft:false});
  writeFileSync(join(dir,'v1.json'),'old invalid sidecar');
  assert.equal(readLyrics(dir,v).kind,'none');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('manual review exposes unresolved lines, saves corrections and protects newer edits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lyrics-review-save-'));
 try{
  const version={id:'v9',audioPath:'/audio/9',input:{lyrics:'创作时的歌词'}};
  const file=join(dir,'v9.json');
  writeFileSync(file,JSON.stringify({
   format:'music-room-lyrics',version:1,versionId:version.id,audioPath:version.audioPath,duration:20,draft:true,
   lines:[{text:'识别错词',start:1,end:3}],
   unresolved:[{text:'还没有起止时间',window:[4,9]},{text:'另一句',reason:'旧稿未保存范围'}],
  }));
  const draft=readLyrics(dir,version);
  assert.equal(draft.kind,'synced');
  assert.equal(draft.duration,20);
  assert.deepEqual(draft.unresolved,[{text:'还没有起止时间',window:[4,9]},{text:'另一句',reason:'旧稿未保存范围'}]);
  const {saveLyricsReview}=await import('./lyrics.ts');
  const write=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value));
  const lines=[{text:'更正后的歌词',start:1,end:3},{text:'已补上时间',start:5,end:8}];
  const update={revision:draft.revision,lines,pending:[{index:1,text:'改过但仍待定位'}]};
  const saved=saveLyricsReview(dir,version,update,write);
  assert.equal(saved.kind,'synced');
  assert.equal(saved.reference,'创作时的歌词');
  assert.equal(saved.manuallyEdited,true);
  assert.equal(saved.draft,true);
  assert.deepEqual(saved.lines,lines);
  assert.deepEqual(saved.unresolved,[{text:'改过但仍待定位',reason:'旧稿未保存范围'}]);
  const stored=readFileSync(file,'utf8');
  assert.throws(()=>saveLyricsReview(dir,version,update,write),/歌词已更新/);
  assert.throws(()=>saveLyricsReview(dir,version,{...update,revision:saved.revision,lines:[{text:'超出音频',start:19,end:21}]},write),/歌词时间轴无效/);
  assert.equal(readFileSync(file,'utf8'),stored);
  const final=saveLyricsReview(dir,version,{...update,revision:saved.revision,pending:[]},write);
  assert.equal(final.draft,false);
  assert.deepEqual(readLyrics(dir,version),final);
  assert.match(lyricsLrc(final.lines),/\[00:05.00\]已补上时间/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
