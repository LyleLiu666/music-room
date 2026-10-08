import test from 'node:test';
import assert from 'node:assert/strict';
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
