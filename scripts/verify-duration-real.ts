// Explicit acceptance with installed models, through the production queue and memory guards.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {MusicService} from '../src/service/service.ts';
if(process.env.MUSIC_ROOM_DURATION_REAL!=='1')throw Error('Set MUSIC_ROOM_DURATION_REAL=1 to run actual model inference');
const directory=process.env.MUSIC_ROOM_YUE2_DIRECTORY!;if(!directory)throw Error('Installed model directory required');
const out=resolve('test-results/duration-real',new Date().toISOString().replaceAll(':','-')),workspace=join(out,'workspace');
await mkdir(join(workspace,'engines'),{recursive:true});await writeFile(join(workspace,'engines/yue2.json'),JSON.stringify({version:1,directory,autoStart:true}));
const svc=await MusicService.open(workspace,()=>{throw Error('unused')},p=>readFile(resolve('public',p)),false);
const results:any[]=[];console.log('Acceptance output: '+out);
try{
 // Like the UI's initial resource panel, warm the verified macOS helper before submission.
 for(let attempt=0;attempt<3;attempt++){
  const status=await svc.call('resource_status',{});if(!status.hardwareError&&status.hardware)break;
  if(attempt===2)throw Error(status.hardwareError??'Hardware unavailable');await new Promise(r=>setTimeout(r,1000));
 }
 for(const instrumental of (process.env.MUSIC_ROOM_DURATION_MODE==='vocal'?[false]:[true,false])){
  const input={targetDuration:180,instrumental,preset:'fast' as const,seed:42,title:'目标时长验收 · '+(instrumental?'纯音乐':'演唱'),style:instrumental?'Instrumental acoustic folk, warm fingerstyle nylon guitar and soft piano, 80 BPM, memorable theme, gentle development, contrasting middle section, theme reprise and a natural outro.':'Mandarin Chinese acoustic folk, gentle warm female vocal, fingerstyle guitar and soft piano, 80 BPM, expressive melody, instrumental introduction and interlude, natural outro.',lyrics:instrumental?'[intro]\n[verse]\n[chorus]\n[interlude]\n[verse]\n[chorus]\n[outro]':'[Verse]\n晚风轻轻经过窗边\n把你的名字念了一遍\n街灯照亮回家的路\n远方的星还在眨眼\n[Chorus]\n留一盏灯等你回来\n让所有心事慢慢盛开\n穿过长夜穿过人海\n我把温柔留在门外\n[Verse]\n雨停之后天空很浅\n我们走过熟悉的街\n你说未来不用太远\n就在明天第一道光线\n[Chorus]\n留一盏灯等你回来\n让所有心事慢慢盛开\n穿过长夜穿过人海\n我把温柔留在门外'};
  if(instrumental&&process.env.MUSIC_ROOM_DURATION_ACCEPTED_ABC)Object.assign(input,{abc:await readFile(process.env.MUSIC_ROOM_DURATION_ACCEPTED_ABC,'utf8')});
  const {job}=await svc.call('yue2_generate',input);let result:any;const deadline=Date.now()+40*60_000;let last='';
  while(Date.now()<deadline){result=await svc.call('yue2_get_job',{jobId:job.id});const status=JSON.stringify({mode:instrumental?'instrumental':'vocal',status:result.job.status,progress:{...result.job.progress,text:undefined},error:result.job.error,resource:result.job.resource});if(status!==last){console.log(status);last=status;}if(['done','failed','cancelled'].includes(result.job.status))break;await new Promise(r=>setTimeout(r,5000));}
  if(result.job.status!=='done'){results.push({input,job:result.job});await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));throw Error(result.job.error??'Timeout');}
  const song=dirname(result.audioPath),summary=JSON.parse(await readFile(join(song,'../summary.json'),'utf8')),duration=JSON.parse(await readFile(join(song,'../duration.json'),'utf8')),request=JSON.parse(await readFile(join(song,'request.json'),'utf8'));
  assert.equal(request.lyrics,input.lyrics);assert.equal(duration.accepted,true);assert.ok(duration.scoreSeconds>=153&&duration.scoreSeconds<=207);assert.equal(summary.truncated.abc,false);assert.equal(summary.truncated.semantic,false);
  const record={input,jobId:job.id,audioPath:result.audioPath,summary,duration,request};results.push(record);await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log('RESULT '+JSON.stringify({instrumental,scoreSeconds:duration.scoreSeconds,audioSeconds:summary.seconds,attempts:duration.attempts}));
 }
}finally{await svc.close();}
