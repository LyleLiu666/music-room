import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {speechEnvironment} from './supervisor.ts';
import {createSpeechDriver} from './runtime.ts';
import {inferScript} from './python.ts';
import {conditioningScript} from './conditioning-python.ts';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('speech worker keeps caches isolated and does not inherit unrelated credentials',()=>{
 const key='MUSIC_ROOM_TEST_SECRET',old=process.env[key];process.env[key]='secret';try{const root='/tmp/语音运行环境',env=speechEnvironment(root);for(const name of ['UV_PROJECT_ENVIRONMENT','UV_PYTHON_INSTALL_DIR','UV_CACHE_DIR','HF_HOME','HF_HUB_CACHE','TORCH_HOME','NLTK_DATA','NUMBA_CACHE_DIR','MPLCONFIGDIR','PYTHONPYCACHEPREFIX','TMPDIR'])assert.ok(env[name]?.startsWith(root+'/'),name);assert.equal(env[key],undefined);assert.equal(env.PYTORCH_ENABLE_MPS_FALLBACK,'1');}finally{if(old===undefined)delete process.env[key];else process.env[key]=old;}
});
test('speech supervisor ends its whole process group when the application lease closes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'speech lease '));let worker:ReturnType<typeof spawn>|undefined;
 try{
  mkdirSync(join(root,'bin'));mkdirSync(join(root,'source'));writeFileSync(join(root,'.music-room-indextts.json'),JSON.stringify({format:'music-room-indextts'}));writeFileSync(join(root,'.music-room-indextts.lock'),JSON.stringify({pid:process.pid,owner:'lease'}));writeFileSync(join(root,'bin','uv'),'#!/bin/sh\nsleep 60 &\nprintf "%s" "$!" > child.pid\nwait\n',{mode:0o755});
  worker=spawn(process.execPath,[fileURLToPath(new URL('../../server/dev.ts',import.meta.url)),'tts-worker'],{stdio:['pipe','pipe','pipe']});let diagnostics='';worker.stderr!.on('data',c=>diagnostics+=c);const closed=new Promise<number|null>(r=>worker!.once('close',r));worker.stdin!.write(JSON.stringify({directory:root,owner:'lease',step:'dependencies'})+'\n');
  const path=join(root,'source','child.pid');for(let i=0;i<250&&(!existsSync(path)||!Number(readFileSync(path,'utf8')));i++)await pause(20);assert.ok(existsSync(path),diagnostics);const pid=Number(readFileSync(path,'utf8'));assert.ok(pid>1,'child PID must be written before checking termination');worker.stdin!.end();await closed;let alive=true;for(let i=0;i<50;i++){try{process.kill(pid,0);}catch{alive=false;break;}await pause(20);}assert.equal(alive,false,'owned subprocess survived lease loss');
 }finally{worker?.stdin?.end();rmSync(root,{recursive:true,force:true});}
});
test('managed speech setup refuses nonempty foreign directories before running commands',async()=>{
 const root=mkdtempSync(join(tmpdir(),'speech foreign '));try{writeFileSync(join(root,'user-file.txt'),'preserve me');await assert.rejects(createSpeechDriver().prepare(root,{signal:new AbortController().signal,report:()=>{},stage:()=>{}}),/空文件夹/);assert.equal(readFileSync(join(root,'user-file.txt'),'utf8'),'preserve me');assert.equal(existsSync(join(root,'.music-room-indextts.json')),false);}finally{rmSync(root,{recursive:true,force:true});}
});

test('speech workers reclaim MPS cache before exceeding the recommended working set, regardless of parent overrides',()=>{
 const names=['PYTORCH_MPS_LOW_WATERMARK_RATIO','PYTORCH_MPS_HIGH_WATERMARK_RATIO'];
 const previous=names.map(name=>process.env[name]);
 try{
  for(const name of names)process.env[name]='0'; // The parent may have disabled both reclamation and the allocation limit.
  const env=speechEnvironment('/tmp/managed-speech');
  assert.equal(Number(env.PYTORCH_MPS_LOW_WATERMARK_RATIO),0.5);
  assert.equal(Number(env.PYTORCH_MPS_HIGH_WATERMARK_RATIO),1);
  assert.ok(Number(env.PYTORCH_MPS_LOW_WATERMARK_RATIO)<Number(env.PYTORCH_MPS_HIGH_WATERMARK_RATIO));
 }finally{names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});

test('the whole third-party inference call disables training gradients, including reference conditioning',t=>{
 // Execute the production Python entry point against small module doubles.
 // Upstream only disables gradients around synthesis; reference conditioning
 // otherwise retains activations through the cached speaker/style tensors.
 const harness=`import sys,types,json
grad_enabled=True
class NoGrad:
 def __enter__(self):
  global grad_enabled
  self.previous=grad_enabled
  grad_enabled=False
 def __exit__(self,*args):
  global grad_enabled
  grad_enabled=self.previous
torch=types.ModuleType('torch')
torch.cuda=types.SimpleNamespace(is_available=lambda:False)
torch.set_num_threads=lambda _:None
torch.no_grad=NoGrad
sys.modules['torch']=torch
package=types.ModuleType('indextts')
package.__path__=[]
sys.modules['indextts']=package
inference=types.ModuleType('indextts.infer_v2')
class IndexTTS2:
 def __init__(self,**kwargs):pass
 def infer(self,**kwargs):
  assert not grad_enabled,'reference conditioning would keep training activations'
  assert kwargs['spk_audio_prompt']=='/tmp/reference.wav'
  assert kwargs['text']=='你好'
  print('INFERENCE_VERIFIED',flush=True)
inference.IndexTTS2=IndexTTS2
sys.modules['indextts.infer_v2']=inference
soundfile=types.ModuleType('soundfile')
soundfile.read=lambda _:([0.2],22050)
soundfile.write=lambda *args,**kwargs:None
sys.modules['soundfile']=soundfile
exec(${JSON.stringify(inferScript)})
assert grad_enabled,'inference left global gradient state changed'
`;
 const result=spawnSync('python3',['-c',harness],{encoding:'utf8',env:{...process.env,MUSIC_ROOM_TTS_DIRECTORY:'/tmp/managed-speech'},input:JSON.stringify({text:'你好',referencePath:'/tmp/reference.wav',outputPath:'/tmp/output.wav'})+'\n'});
 if((result.error as NodeJS.ErrnoException)?.code==='ENOENT'){t.skip('python3 unavailable; real inference verification requires the managed runtime');return;}
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/INFERENCE_VERIFIED/);
});

test('emotion follows the full LLM judgment and releases its model before synthesis',()=>{
 const harness=`import types,json
from pathlib import Path
${conditioningScript}
events=[]
class Classifier:
 eos_token_id=1
 def __init__(self,path):
  events.append('loaded')
  self.tokenizer=self
  self.model=types.SimpleNamespace(device='cpu',generate=self.generate,to=lambda device:None)
 def apply_chat_template(self,messages,**kwargs):
  assert messages[1]['content']=='I am not depressed; sound joyful.'
  return 'complete-description'
 def __call__(self,*args,**kwargs):return Inputs()
 def generate(self,**kwargs):
  assert kwargs['max_new_tokens']==256
  return [[1,2,3]]
 def decode(self,*args,**kwargs):return '{"悲伤":0.9,"低落":0.1}'
 def convert(self,values):return values
 def __del__(self):events.append('released')
class Inputs(dict):
 input_ids=types.SimpleNamespace(shape=(1,1))
 def to(self,device):return self
class NoGrad:
 def __enter__(self):pass
 def __exit__(self,*args):pass
torch=types.SimpleNamespace(no_grad=NoGrad,backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda:False)))
upstream=types.SimpleNamespace(QwenEmotion=Classifier)
assert prepare_emotion(upstream,Path('/model'),'',torch) is None
assert events==[]
result=prepare_emotion(upstream,Path('/model'),'I am not depressed; sound joyful.',torch)
assert result=={'悲伤':0.9,'低落':0.1},'an input word changed the model judgment'
assert events==['loaded','released']
print('EMOTION_VERIFIED')
`;
 const result=spawnSync('python3',['-c',harness],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/EMOTION_VERIFIED/);
});


test('builtin short utterances remain continuous without enlarging long-text segments',()=>{
 // Counts captured with the pinned upstream BPE tokenizer for the two reported inputs.
 const cases=[
  {text:'大家好，我是迪丽热巴，在这个群里我最喜欢彪哥，爱你呦',tokens:49,continuous:true},
  {text:'大家好我是迪丽热巴。在这个群里我最喜欢彪哥，爱你呦！',tokens:50,continuous:true},
  {text:'short utterance at budget boundary',tokens:60,continuous:true},
  {text:'paragraph above budget boundary',tokens:61,continuous:false},
  {text:'long paragraph fixture',tokens:160,continuous:false},
 ];
 const entry=inferScript.replace(conditioningScript,`def load_conditioning(*args):return {}
def prepare_emotion(*args):return None
def install_conditioning(*args):pass`);
 for(const item of cases){
  const harness=`import sys,types,json
from contextlib import nullcontext
case=json.loads(${JSON.stringify(JSON.stringify(item))})
torch=types.ModuleType('torch')
torch.cuda=types.SimpleNamespace(is_available=lambda:False)
torch.backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda:False))
torch.nn=types.SimpleNamespace(Module=lambda:None)
torch.zeros=lambda _:None
torch.ones=lambda _:None
torch.set_num_threads=lambda _:None
torch.no_grad=nullcontext
sys.modules['torch']=torch
package=types.ModuleType('indextts')
package.__path__=[]
sys.modules['indextts']=package
inference=types.ModuleType('indextts.infer_v2')
class IndexTTS2:
 def __init__(self,**kwargs):
  self.tokenizer=types.SimpleNamespace(tokenize=lambda text:list(range(case['tokens'])))
 def infer(self,**kwargs):
  budget=kwargs['max_text_tokens_per_segment']
  if case['continuous']:
   assert budget>=case['tokens'],'a short utterance is split into independent generations'
   assert budget<=60,'short-utterance budget must remain bounded'
  else:
   assert budget==40,'long-text generation increased its tested memory budget'
  print('SEGMENTATION_VERIFIED',flush=True)
inference.IndexTTS2=IndexTTS2
sys.modules['indextts.infer_v2']=inference
soundfile=types.ModuleType('soundfile')
soundfile.read=lambda _:([0.2],22050)
soundfile.write=lambda *args,**kwargs:None
sys.modules['soundfile']=soundfile
exec(${JSON.stringify(entry)})
`;
  const result=spawnSync('python3',['-c',harness],{encoding:'utf8',env:{...process.env,MUSIC_ROOM_TTS_DIRECTORY:'/tmp/managed-speech'},input:JSON.stringify({text:item.text,referencePath:'/tmp/reference.wav',outputPath:'/tmp/output.wav',conditioningPath:'/tmp/features.npz'})+'\n'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/SEGMENTATION_VERIFIED/);
 }
});


test('Apple Silicon defaults to native inference and explicit Python selection remains available',()=>{
 const old=process.env.MUSIC_ROOM_TTS_BACKEND;
 try{
  delete process.env.MUSIC_ROOM_TTS_BACKEND;
  if(process.platform==='darwin'&&process.arch==='arm64')assert.equal(createSpeechDriver().engineLabel,'audio.cpp F16');
  process.env.MUSIC_ROOM_TTS_BACKEND='python';assert.equal(createSpeechDriver().engineLabel,'PyTorch');
  process.env.MUSIC_ROOM_TTS_BACKEND='unknown';assert.throws(()=>createSpeechDriver(),/MUSIC_ROOM_TTS_BACKEND/);
 }finally{if(old===undefined)delete process.env.MUSIC_ROOM_TTS_BACKEND;else process.env.MUSIC_ROOM_TTS_BACKEND=old;}
});
