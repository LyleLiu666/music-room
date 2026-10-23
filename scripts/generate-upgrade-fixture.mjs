// Deliberately uses a pinned historical implementation, never today's serializer.
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,symlink,writeFile,readFile,readdir,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const commit=execFileSync('git',['rev-parse','c3a2133^{commit}'],{encoding:'utf8'}).trim();
const temp=await mkdtemp(join(tmpdir(),'music-historical-source-'));
const destination=resolve(process.argv[2]??'tests/fixtures/workspace-2026-10-10');
await mkdir(destination); // Refuse to silently replace the pinned regression fixture.
try{
 execFileSync('tar',['-x','-C',temp],{input:execFileSync('git',['archive',commit,'src'],{maxBuffer:32*2**20})});
 await symlink(resolve('node_modules'),join(temp,'node_modules'));await writeFile(join(temp,'package.json'),' {"type":"module"}');
 const {MusicService}=await import(pathToFileURL(join(temp,'src/service/service.ts')));
 const {testResources}=await import(pathToFileURL(join(temp,'src/service/resources/testing.ts')));
 const {encodeWav}=await import(pathToFileURL(join(temp,'src/wav.ts')));
 const wav=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.2)],22050));
 const music={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const speech={installed:()=>true,prepare:async()=>{},generate:async(_,request)=>writeFile(request.outputPath,wav)};
 const root=join(temp,'workspace'),service=await MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,music,speech,undefined,testResources());
 let identities;
 try{
  await service.call('create_project',{projectId:'historical',title:'旧版本项目',requirements:'保留旧声音、父子关系、原件和试听决定'});
  const clip=await service.call('studio_create_sound',{projectId:'historical',title:'旧乐谱',kind:'clip'});
  const score=await service.call('studio_import_score',{soundId:clip.id,compositionJson:await readFile(join(temp,'src/music/authoring/example.json'),'utf8')});
  await service.call('studio_update_version',{versionId:score.id,kept:true,final:true});
  await service.call('add_feedback',{projectId:'historical',revisionId:score.id,text:'保留这一句旋律'});
  const sound=await service.call('studio_create_sound',{projectId:'historical',title:'旧旁白',kind:'speech'});
  const voice=await service.call('tts_add_voice',{cleanup:false,name:'合成测试参考',audioBase64:Buffer.from(wav).toString('base64')});
  const speak=async(text,parentId)=>{
   const version=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text,parentId});
   for(let n=0;n<200;n++){const current=await service.call('tts_get_version',{versionId:version.id});if(current.state==='succeeded')return current;if(['failed','interrupted','cancelled'].includes(current.state))throw Error(JSON.stringify(current));await new Promise(r=>setTimeout(r,10));}throw Error('historical fixture timed out');
  };
  const first=await speak('旧版第一条旁白。');await service.call('studio_update_version',{versionId:first.id,final:true,kept:true});
  const second=await speak('旧版第二条旁白。',first.id);await service.call('studio_update_version',{versionId:second.id,deleted:true});
  await service.call('create_project',{projectId:'historical-trash',title:'旧回收站项目'});await service.call('studio_update_project',{projectId:'historical-trash',deleted:true});
  await service.call('studio_library',{});identities={clipId:clip.id,scoreId:score.id,speechSoundId:sound.id,voiceId:voice.id,firstId:first.id,deletedId:second.id};
 }finally{await service.close();}
 await cp(root,join(destination,'workspace'),{recursive:true});
 const hashes={};async function inventory(directory,prefix=''){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name),relative=prefix+entry.name;if(entry.isDirectory())await inventory(path,relative+'/');else hashes[relative]=createHash('sha256').update(await readFile(path)).digest('hex');}}
 await inventory(join(destination,'workspace'));
 await writeFile(join(destination,'provenance.json'),JSON.stringify({sourceCommit:commit,generatedAt:new Date().toISOString(),generator:'scripts/generate-upgrade-fixture.mjs',models:'deterministic synthetic speech; no real inference',identities,sha256:hashes},null,2)+'\n');
 console.log(JSON.stringify({destination,sourceCommit:commit,files:Object.keys(hashes).length}));
}finally{await rm(temp,{recursive:true,force:true});}
