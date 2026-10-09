import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {YuE2Client} from './client.ts';
test('instrumental and vocal generation use distinct adapter settings and reject unsafe artifact ids',async t=>{
  let submitted:unknown;
  const id='a'.repeat(32),server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    if(req.method==='POST')submitted=JSON.parse(body);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({job:{id,status:'queued',kind:'create',error:null}}));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const client=new YuE2Client({endpoint:async()=>url,status:async()=>({directory:'/selected'})} as any);
  const result=await client.generate({style:'piano groove',lyrics:'[instrumental]',preset:'fast',instrumental:true,seed:42});
  assert.equal(result.job.id,id);
  assert.deepEqual(submitted,{kind:'create',preset:'fast',params:{style:'piano groove',lyrics:'[instrumental]',cot:'full',seed:42,cfg_scale:2},loras:[{name:'ar_lora_inst_v3abc.bf16',scale:1},{name:'nar_lora_joint_v4.bf16',scale:1}]});
  const lyrics='[Verse]\n晚风吹过我的手\n\n[Chorus]\n留一盏灯等风来';
  await client.generate({style:'Mandarin piano R&B, warm male vocal',lyrics,preset:'fast',instrumental:false});
  assert.deepEqual(submitted,{kind:'create',preset:'fast',params:{style:'Mandarin piano R&B, warm male vocal',lyrics,cot:'full'},loras:[]});
  await assert.rejects(client.job('../etc/passwd'),/Invalid/);
});

test('permanent music deletion only removes the selected owned song; unsafe roots and symlinks are rejected',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'music-purge-')),root=await realpath(temp),id='a'.repeat(32),sibling='b'.repeat(32);
 const client=new YuE2Client({status:async()=>({directory:root})} as any);
 try{
  await mkdir(join(root,'data','songs',id,'song'),{recursive:true});await mkdir(join(root,'data','songs',sibling),{recursive:true});await writeFile(join(root,'data','songs',id,'song/audio.flac'),'audio');await writeFile(join(root,'data','songs',sibling,'audio.flac'),'keep');await writeFile(join(root,'weights.bin'),'weights');
  await assert.rejects(client.purgeAudio(id),/不属于/);assert.equal(await readFile(join(root,'data','songs',id,'song/audio.flac'),'utf8'),'audio');
  await writeFile(join(root,'.music-room-yue2.json'),JSON.stringify({format:'music-room-yue2',version:1}));await client.purgeAudio(id);await assert.rejects(readFile(join(root,'data','songs',id,'song/audio.flac')),{code:'ENOENT'});assert.equal(await readFile(join(root,'data','songs',sibling,'audio.flac'),'utf8'),'keep');assert.equal(await readFile(join(root,'weights.bin'),'utf8'),'weights');
  await symlink(join(root,'data','songs',sibling),join(root,'data','songs',id));await assert.rejects(client.purgeAudio(id),/符号链接/);assert.equal(await readFile(join(root,'data','songs',sibling,'audio.flac'),'utf8'),'keep');await assert.rejects(client.purgeAudio('../weights.bin'),/Invalid/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
