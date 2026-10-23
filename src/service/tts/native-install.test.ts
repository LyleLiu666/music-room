import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {installNative,nativeInstalled} from './native-install.ts';

test('a failed model upgrade preserves the previously ready program, model and installation record',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-install-rollback-'));
 const server=createServer((_,res)=>{res.writeHead(503);res.end('unavailable');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=join(root,'audio-cpp'),program=join(base,'release/audiocpp_server'),model=join(base,'models/index-tts2-f16.gguf');
  await mkdir(join(base,'release'),{recursive:true});await mkdir(join(base,'models'),{recursive:true});
  await writeFile(program,'previous verified program');await writeFile(model,'previous verified model');
  const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
  const old={version:'old',programSha256:'old-archive',modelSha256:hash(await readFile(model)),modelBytes:(await stat(model)).size,programUrl:'unused',modelUrl:'unused'};
  const stamp=async(path:string)=>{const s=await stat(path);return {bytes:s.size,mtimeMs:s.mtimeMs};};
  const metadata=JSON.stringify({engine:'audio.cpp',version:old.version,precision:'f16',programSha256:old.programSha256,modelSha256:old.modelSha256,program:await stamp(program),model:await stamp(model)});
  await writeFile(join(base,'installed.json'),metadata);assert.equal(nativeInstalled(root,old),true);
  const archiveRoot=join(root,'archive');await mkdir(archiveRoot);await writeFile(join(archiveRoot,'audiocpp_server'),'replacement program');
  const archive=join(root,'program.tar.gz');execFileSync('/usr/bin/tar',['-czf',archive,'-C',archiveRoot,'audiocpp_server']);const bytes=await readFile(archive);
  const next={...old,version:'new',programSha256:hash(bytes),modelSha256:hash('new model'),modelBytes:9,modelUrl:`http://127.0.0.1:${(server.address() as any).port}/model`};
  await assert.rejects(installNative(root,{signal:new AbortController().signal,stage:()=>{},report:()=>{}},next,async()=>bytes),/503/);
  assert.equal(await readFile(program,'utf8'),'previous verified program');
  assert.equal(await readFile(model,'utf8'),'previous verified model');
  assert.equal(await readFile(join(base,'installed.json'),'utf8'),metadata);
  assert.equal(nativeInstalled(root,old),true);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await rm(root,{recursive:true,force:true});}
});
