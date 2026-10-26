/** Opt-in real integration: preserved workspace, real admission and owned processes. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {ProjectStore} from '../src/service/projects/store.ts';
import {SpeechService,wavInfo} from '../src/service/tts/speech.ts';
import {createSpeechDriver} from '../src/service/tts/runtime.ts';
import {createResources} from '../src/service/resources/runtime.ts';
import {joinSpeechWaves} from '../src/service/tts/segments.ts';
if(process.env.MUSIC_ROOM_BREEZE_REAL!=='1')throw Error('Set MUSIC_ROOM_BREEZE_REAL=1 for real models');
const root=resolve('test-results/breeze-integration-2026-10-26/real-'+Date.now());mkdirSync(root,{recursive:true});
const store=await ProjectStore.open(root),resources=createResources(),speech=await SpeechService.open(store,createSpeechDriver(),()=>false,resources);
const report:any={root,results:[],humanListening:'pending'},save=()=>writeFileSync(join(root,'verification.json'),JSON.stringify(report,null,2));
async function wait(id:string){const until=Date.now()+600000;let last='';while(Date.now()<until){const v=speech.job(id);const state=v.state+' '+v.stage;if(state!==last){console.log(state);last=state;}if(!['queued','running'].includes(v.state))return v;await new Promise(r=>setTimeout(r,500));}await speech.cancel(id);throw Error('Real inference exceeded 10 minute bound');}
try{assert.ok(speech.status().canGenerate);await store.createProject('breeze','Breeze integration');const sound=await speech.createSound('breeze','兼容验证'),audio=readFileSync(resolve('public/tts-presets/official.wav')),voice=speech.addVoice('官方参考',audio),longVoice=speech.addVoice('六遍参考（仅资源边界测试）',joinSpeechWaves(Array(6).fill(audio)));
 const cases=[
  {name:'short',voiceId:voice.id,text:'下午的阳光落在窗边，咖啡还有一点温热。我们不急着出发，先把这首歌听完，再慢慢走回家。',referenceText:'翻译翻译，什么叫惊喜？'},
  {name:'long-directed',voiceId:voice.id,text:'周末，我去了一家藏在巷子里的旧唱片店。老板没有急着介绍，只是把正在播放的音乐调小了一点。我随手翻了几张唱片，发现其中一张，正是很多年前在朋友家听过的。那时候，我们总觉得以后的日子还很长。走出店门，天已经暗了，路口的灯一盏接一盏亮起来。我忽然觉得，有些东西虽然很久没见，却一直没有走远。再往前走，熟悉的街道渐渐安静下来。',referenceText:'翻译翻译，什么叫惊喜？',emotion:'平静，带一点怀念',emotionStrength:'flat' as const},
  {name:'long-reference',voiceId:longVoice.id,text:'今天的天气很好，我们出发吧。',referenceText:'翻译翻译，什么叫惊喜？'.repeat(6)},
  {name:'legacy',voiceId:voice.id,text:'今天的天气很好，我们出发吧。'},
 ];
 for(const c of cases){const start=Date.now(),{name,...input}=c,v=speech.generate({...input,soundId:sound.id,seed:42});const done=await wait(v.id);report.results.push({name,seconds:(Date.now()-start)/1000,version:done,logs:speech.status().logs});save();assert.equal(done.state,'succeeded',done.error??'generation failed');assert.equal(done.engine,c.referenceText?'Breeze TTS 2':'IndexTTS 2.0');const info=wavInfo(speech.audio(done.id));assert.ok(info.duration>1&&info.peak>.001);}
 const probe=speech.generate({soundId:sound.id,voiceId:voice.id,text:'这是一段取消测试。'.repeat(80),referenceText:'翻译翻译，什么叫惊喜？'});for(let i=0;i<120&&speech.job(probe.id).state==='queued';i++)await new Promise(r=>setTimeout(r,500));assert.equal(speech.job(probe.id).state,'running');await new Promise(r=>setTimeout(r,4000));const start=Date.now();await speech.cancel(probe.id);assert.equal(speech.job(probe.id).state,'cancelled');assert.equal(existsSync(join(root,'speech','audio',probe.id+'.wav')),false);report.cancellation={seconds:(Date.now()-start)/1000,state:speech.job(probe.id).state};report.status='passed';save();
}catch(error){report.status='failed';report.error=String(error);save();throw error;}
finally{await speech.close();await resources.close();await store.close();console.log(root);}
