// Explicit, resource-intensive acceptance. Does not run in normal tests or download implicitly.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {runtimeEnvironment} from '../src/service/yue2/worker.ts';
const workspace=process.env.MUSIC_ROOM_WORKSPACE,directory=process.env.MUSIC_ROOM_YUE2_DIRECTORY;
if(process.env.MUSIC_ROOM_YUE2_REAL!=='1'||!workspace||!directory)throw new Error('Explicit acceptance requires MUSIC_ROOM_YUE2_REAL=1, MUSIC_ROOM_WORKSPACE and MUSIC_ROOM_YUE2_DIRECTORY; prepare models first.');
const root=await realpath(directory),out=resolve('test-results/yue2-real');await mkdir(out,{recursive:true});
const client=new Client({name:'real-yue2-acceptance',version:'1'});let browser,jobId,done=false;
try{
  await client.connect(new StdioClientTransport({command:resolve('release/music-room'),args:['mcp','--workspace',workspace],env:{...process.env,PATH:'/usr/bin:/bin'},stderr:'pipe'}));
  const tool=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
  let state=await tool('yue2_status');for(let n=0;!state.canGenerate&&['starting','preparing'].includes(state.phase)&&n<120;n++){await new Promise(r=>setTimeout(r,1000));state=await tool('yue2_status');}assert.equal(state.directory,root);assert.ok(state.canGenerate,state.error??'models must actually be ready');
  const upstream=await (await fetch(state.url+'/api/status')).json();assert.equal(upstream.fake,false);assert.equal(upstream.models.present,true);
  const result=await tool('yue2_generate',{title:'YuE2 · 自动启动验收',style:'Instrumental mandopop piano R&B, a concise 20 second miniature with a clear memorable two-bar piano riff, syncopated soft drums, warm bass, a short answering phrase and a natural ending. No vocals, no singing. Intimate, melodic, structured.',lyrics:'[instrumental]',preset:'fast',instrumental:true,seed:42});jobId=result.job.id;console.log('Real MLX generation submitted: '+jobId);
  let generated,last='';const deadline=Date.now()+30*60*1000;
  while(Date.now()<deadline){generated=await tool('yue2_get_job',{jobId});const progress=JSON.stringify({status:generated.job.status,progress:generated.job.progress,error:generated.job.error});if(progress!==last){console.log(progress);last=progress;}if(['done','failed','cancelled'].includes(generated.job.status))break;await new Promise(r=>setTimeout(r,5000));}
  assert.equal(generated?.job.status,'done',generated?.job.error??'generation timed out');done=true;
  const audio=await realpath(generated.audioPath),rel=relative(root,audio);assert.ok(!rel.startsWith('..')&&!isAbsolute(rel));const bytes=await readFile(audio);assert.equal(bytes.subarray(0,4).toString(),'fLaC');
  const analysis=JSON.parse(execFileSync(join(root,'.venv','bin','python'),['-c',`import soundfile as sf,numpy as np,json,sys
x,sr=sf.read(sys.argv[1],always_2d=True)
print(json.dumps({'seconds':len(x)/sr,'sampleRate':sr,'channels':x.shape[1],'peak':float(np.max(np.abs(x))),'rms':float(np.sqrt(np.mean(x*x))),'finite':bool(np.all(np.isfinite(x)))}))`,audio],{env:runtimeEnvironment(root),encoding:'utf8'}));
  assert.ok(analysis.finite);assert.ok(analysis.seconds>3);assert.ok(analysis.rms>0.001);assert.ok(analysis.peak<=1);
  const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
  const response=await fetch(runtime.url+'/yue2-audio/'+jobId,{headers:{authorization:`Bearer ${runtime.token}`}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(runtime.url);await page.click('#yue2-jump');await page.locator('#yue2-state').filter({hasText:'模型就绪'}).waitFor();await page.locator('#yue2-jobs .service-job').filter({hasText:'YuE2 · 自动启动验收'}).getByRole('button',{name:'试听',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('#yue2-audio audio')?.currentTime>.1);assert.ok(Math.abs(await page.$eval('#yue2-audio audio',a=>a.duration)-analysis.seconds)<.1);assert.deepEqual(errors,[]);await page.locator('.yue2-panel').screenshot({path:join(out,'generated.png')});
  const report={hardware:'Apple Silicon',fake:false,jobId,audioPath:audio,bytes:bytes.length,analysis,timing:generated.job.timing,checks:['official stdio MCP connects to standalone binary','actual MLX engine and weights','instrumental AR/NAR adapters','real job completes all inference stages','FLAC is finite and non-silent','authenticated download matches saved audio','browser plays FLAC with correct duration'],errors};await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(jobId&&!done){try{await client.callTool({name:'yue2_cancel_job',arguments:{jobId}});}catch{}}await browser?.close();await client.close();}
