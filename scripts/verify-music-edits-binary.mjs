import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,chmod,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectStore} from '../src/service/projects/store.ts';
const root=await realpath(await mkdtemp(join(tmpdir(),'music-edit-binary-'))),workspace=join(root,'workspace'),engine=join(root,'engine'),binary=join(root,'music-room');
const sourceId='version-source',jobId='a'.repeat(32),soundId='sound-source',abc=await readFile('src/trials/yue2/fixture.abc','utf8');
await copyFile(resolve('release/music-room'),binary);await chmod(binary,0o755);
const store=await ProjectStore.open(workspace);await store.createProject('edit-binary','打包验证');await store.close();
const song=join(engine,'data','songs',jobId,'song');await mkdir(song,{recursive:true});await writeFile(join(engine,'.music-room-yue2.json'),JSON.stringify({format:'music-room-yue2',version:1}));await writeFile(join(song,'score.abc'),abc);await writeFile(join(song,'audio.flac'),'fLaC0000');
const source={id:sourceId,soundId,number:1,createdAt:new Date().toISOString(),state:'succeeded',stage:'生成完成',kept:false,deleted:false,input:{soundId,text:'钢琴伴奏',instrumental:false,lyrics:'[verse]\nhello\n[outro]',seed:42},source:{kind:'music',id:jobId},audioPath:`/yue2-audio/${jobId}`};
await writeFile(join(workspace,'studio.json'),JSON.stringify({format:'music-room-studio',version:1,sounds:[{id:soundId,projectId:'edit-binary',title:'原曲',kind:'music',createdAt:source.createdAt}],versions:[source]}));
await mkdir(join(workspace,'engines'),{recursive:true});await writeFile(join(workspace,'engines','yue2-jobs.json'),JSON.stringify({version:1,jobs:[{job:{id:jobId,kind:'create',status:'done'},directory:engine,upstreamId:jobId}]}));
let started=false;
try{
 const output=JSON.parse(execFileSync(binary,['start','--workspace',workspace],{cwd:root,encoding:'utf8'}));started=true;
 const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
 const call=async(name,args)=>{const response=await fetch(output.url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:JSON.stringify(args)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
 const draft=await call('studio_music_edit_open',{versionId:sourceId,kind:'transfer'});
 const candidate=await call('studio_music_edit_prepare',{draftId:draft.id,revision:draft.revision,style:'钢琴器乐',change:{kind:'transfer',overlap:'error'}});
 assert.equal(candidate.candidate.input.instrumental,true);assert.equal(candidate.candidate.summary.voices.Vocal.sounding_notes,0);
 const harmony=await call('studio_music_edit_open',{versionId:sourceId,kind:'harmony'}),brief=await call('studio_music_edit_brief',{draftId:harmony.id,instruction:'只改和弦'});
 assert.match(brief.text,/任意 AI \/ LLM/);assert.doesNotMatch(brief.text,/Codex/);
 const html=await(await fetch(output.url)).text();assert.match(html,/assets\/main-/);
 console.log('Copied binary: embedded ABC parser, instrumental draft, generic AI export and production UI passed. No model inference started.');
}finally{if(started)execFileSync(binary,['stop','--workspace',workspace],{cwd:root,stdio:'pipe'});await rm(root,{recursive:true,force:true});}
