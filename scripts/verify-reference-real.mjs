import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {ProjectStore} from '../src/service/projects/store.ts';
import {SpeechService,wavInfo} from '../src/service/tts/speech.ts';
import {createSpeechDriver} from '../src/service/tts/runtime.ts';
if(process.env.MUSIC_ROOM_REFERENCE_REAL!=='1')throw Error('Set MUSIC_ROOM_REFERENCE_REAL=1 to run local UVR models.');
const directory=process.env.MUSIC_ROOM_TTS_DIRECTORY??join(homedir(),'Music','IndexTTS2'),output=resolve('test-results/reference-real');
await mkdir(output,{recursive:true});
const python=join(directory,'reference-cleanup','.venv','bin','python');
// Known target voice plus controlled music, noise and reflections. No user audio is sent elsewhere.
execFileSync(python,['-c',`import numpy as np,soundfile as sf,librosa,sys
from pathlib import Path
out=Path(sys.argv[1]);s,sr=sf.read(sys.argv[2],always_2d=True);s=s.mean(axis=1);s=librosa.resample(s,orig_sr=sr,target_sr=22050)[:6*22050];s=s*.5/max(np.max(np.abs(s)),.001)
n=len(s);t=np.arange(n)/22050;music=.13*np.sin(2*np.pi*220*t)+.1*np.sin(2*np.pi*330*t)+.08*np.sin(2*np.pi*440*t);music*=.6+.4*np.sin(2*np.pi*.8*t)**2
noise=np.random.default_rng(42).normal(0,.016,n);wet=s.copy()
for seconds,gain in [(.08,.3),(.17,.22),(.31,.14)]:
 d=int(seconds*22050);wet[d:]+=gain*s[:-d]
mix=wet+music+noise
sf.write(out/'target.wav',s,22050,subtype='PCM_16');sf.write(out/'original.wav',mix,22050,subtype='PCM_16')
`,output,join(directory,'source','examples','voice_01-pcm.wav')],{stdio:'inherit'});
const root=await mkdtemp(join(tmpdir(),'reference-real-')),store=await ProjectStore.open(root);await mkdir(store.path('speech'),{recursive:true});store.atomicJSON(store.path('speech','library.json'),{format:'music-room-speech',version:1,directory,voices:[],sounds:[],versions:[]});const driver=process.env.MUSIC_ROOM_REFERENCE_BINARY?createSpeechDriver(resolve(process.env.MUSIC_ROOM_REFERENCE_BINARY),['tts-worker']):createSpeechDriver();const speech=await SpeechService.open(store,driver);
try{
 const original=new Uint8Array(await readFile(join(output,'original.wav'))),voice=speech.addVoice('真实模型清理验证',original,true);let previous='';
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){const v=speech.snapshot().voices.find(v=>v.id===voice.id),p=v.processing;if(p.stage!==previous){console.log(p.stage);previous=p.stage;}if(p.state==='failed')throw Error(p.error);if(p.state==='succeeded')break;await new Promise(r=>setTimeout(r,1000));}
 const result=speech.snapshot().voices.find(v=>v.id===voice.id);assert.equal(result.processing.state,'succeeded');const cleaned=speech.voiceAudio(voice.id);assert.deepEqual(speech.voiceAudio(voice.id,true),original);assert.notDeepEqual(cleaned,original);assert.ok(wavInfo(cleaned).peak>.1);await writeFile(join(output,'cleaned.wav'),cleaned);
 const metrics=JSON.parse(execFileSync(python,['-c',`import numpy as np,soundfile as sf,sys,json
from scipy.signal import correlate,correlation_lags
from pathlib import Path
p=Path(sys.argv[1]);target,_=sf.read(p/'target.wav');original,_=sf.read(p/'original.wav');cleaned,_=sf.read(p/'cleaned.wav')
c=correlate(cleaned,target,method='fft');lag=int(correlation_lags(len(cleaned),len(target))[np.argmax(c)])
start=max(0,-lag);offset=max(0,lag);n=min(len(target)-start,len(cleaned)-offset);s=target[start:start+n];o=original[start:start+n];a=cleaned[offset:offset+n]
def sdr(x):
 projected=s*np.dot(x,s)/np.dot(s,s);return float(10*np.log10((np.dot(projected,projected)+1e-12)/(np.sum((x-projected)**2)+1e-12)))
print(json.dumps({'samples':n,'lag':lag,'originalSI_SDR':sdr(o),'cleanedSI_SDR':sdr(a),'improvementDb':sdr(a)-sdr(o),'voiceCorrelation':float(np.corrcoef(a,s)[0,1])}))
`,output],{encoding:'utf8'}));
 assert.ok(metrics.voiceCorrelation>.3,JSON.stringify(metrics));assert.ok(metrics.improvementDb>1,JSON.stringify(metrics));
 await writeFile(join(output,'report.json'),JSON.stringify({pipeline:result.processing.pipeline,original:wavInfo(original),cleaned:wavInfo(cleaned),metrics,scope:'Controlled mixture of official sample voice, synthetic music, noise and reflections; does not prove quality for every song or speaker.'},null,2));console.log(JSON.stringify(metrics));
}finally{await speech.close();await store.close();await rm(root,{recursive:true,force:true});}
