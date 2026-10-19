// Verify the copied binary and its packaged score checker without starting inference.
import {mkdtemp,mkdir,readFile,writeFile,copyFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const engine=process.env.MUSIC_ROOM_YUE2_DIRECTORY;if(!engine)throw Error('Installed YuE2 directory required');
const root=await mkdtemp(join(tmpdir(),'music-duration-binary-')),workspace=join(root,'workspace'),binary=join(root,'music-room');
await copyFile(resolve('release/music-room'),binary);await chmod(binary,0o755);
await mkdir(join(workspace,'engines'),{recursive:true});await writeFile(join(workspace,'engines/yue2.json'),JSON.stringify({version:1,directory:engine,autoStart:false}));
let started=false;
try{
 const {url}=JSON.parse(execFileSync(binary,['start','--workspace',workspace],{cwd:root,encoding:'utf8'}));started=true;
 const session=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
 const call=async(name,input)=>{const response=await fetch(url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+session.token,'content-type':'application/json'},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
 const abc='X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=60\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n'+('V: Vocal\nC32|\nV: Ins\nZ|\n').repeat(15);
 const base={style:'piano',lyrics:'[instrumental]',instrumental:true,abc};
 const good=await call('yue2_inspect_input',{...base,targetDuration:60});assert.equal(good.status,200);assert.equal(good.data.context.issue,undefined);
 const bad=await call('yue2_inspect_input',{...base,targetDuration:180});assert.equal(bad.status,200);assert.match(bad.data.context.issue,/自定义乐谱预计 60 秒/);
 const invalid=await call('yue2_inspect_input',{...base,targetDuration:61});assert.notEqual(invalid.status,200);
 const resource=await call('resource_status',{});assert.equal(resource.data.active,undefined);assert.equal(resource.data.residents.length,0);
 console.log('Copied binary: target contract, actual tokenizer, packaged ABC duration check and no model loading passed.');
}finally{if(started)execFileSync(binary,['stop','--workspace',workspace],{cwd:root,stdio:'pipe'});await rm(root,{recursive:true,force:true});}
