import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emotionAlpha} from './emotion.ts';
import {parseOperation} from '../operations.ts';
import {referenceEmotionStrengthScript} from './emotion-python.ts';
import {inferScript} from './python.ts';
import {conditioningScript} from './conditioning-python.ts';
test('stable tiers map to independent alpha values and legacy missing fields preserve old defaults',()=>{
 for(const emotion of ['开心',undefined,'   '])assert.deepEqual(['flat','normal','strong'].map(tier=>emotionAlpha(emotion,tier as 'flat'|'normal'|'strong')),[.3,.6,1]);
 assert.equal(emotionAlpha('开心'),.6);assert.equal(emotionAlpha(),1);assert.equal(emotionAlpha('   '),1);
 assert.throws(()=>emotionAlpha('', 'unknown' as 'flat'));
});
test('reference mixing uses a learned calm condition, leaves source vectors intact, and strength one bypasses override',()=>{
 const harness=`import types
${referenceEmotionStrengthScript}
class Vector(float):
 def unsqueeze(self,axis):return self
for strength in [.3,.6,1.0]:
 calls=[]
 def original(*args,**kwargs):
  calls.append((args,kwargs))
  return Vector(10)
 tts=types.SimpleNamespace(gpt=types.SimpleNamespace(merge_emovec=original),cache_s2mel_style='speaker-style',spk_matrix=[['matching-speaker']],emo_matrix=[[Vector(2)]])
 def closest(style,matrix):
  assert style=='speaker-style' and matrix==['matching-speaker']
  return 0
 install_reference_emotion_strength(tts,strength,closest)
 if strength==1.0:assert tts.gpt.merge_emovec is original
 for i in range(2):assert abs(tts.gpt.merge_emovec('reference',alpha=1.0)-(2+strength*8))<1e-9
 assert tts.emo_matrix==[[2]] and len(calls)==2
print('REFERENCE_MIX_VERIFIED')
`;
 const result=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/REFERENCE_MIX_VERIFIED/);
});
test('Python production entry passes every tier and keeps blank/text/legacy branches distinct',()=>{
 const entry=inferScript.replace(conditioningScript,`def load_conditioning(*args):return None
def prepare_emotion(*args):return None
def install_conditioning(*args):pass`);
 const cases=[...['开心',undefined].flatMap(emotion=>['flat','normal','strong'].map(emotionStrength=>({emotion,emotionStrength}))),{emotion:'开心'},{emotion:undefined}];
 for(const input of cases){const harness=`import sys,types,json
from contextlib import nullcontext
case=json.loads(${JSON.stringify(JSON.stringify(input))})
torch=types.ModuleType('torch');torch.cuda=types.SimpleNamespace(is_available=lambda:False);torch.no_grad=nullcontext;torch.set_num_threads=lambda _:None
sys.modules['torch']=torch
package=types.ModuleType('indextts');package.__path__=[];sys.modules['indextts']=package
inference=types.ModuleType('indextts.infer_v2')
class IndexTTS2:
 def __init__(self,**kwargs):
  self.original=lambda *args,**kwargs:10.0
  self.gpt=types.SimpleNamespace(merge_emovec=self.original)
 def infer(self,**kwargs):
  expected={'flat':.3,'normal':.6,'strong':1.0}.get(case.get('emotionStrength'),.6 if case.get('emotion') else 1.0)
  assert kwargs['emo_alpha']==expected
  assert kwargs['use_emo_text']==bool(case.get('emotion'))
  assert kwargs['emo_text']==(case.get('emotion') or None)
  overridden=not case.get('emotion') and case.get('emotionStrength') in ['flat','normal']
  assert (self.gpt.merge_emovec is not self.original)==overridden
  print('TIER_FORWARDED')
inference.IndexTTS2=IndexTTS2;inference.find_most_similar_cosine=lambda *_:0;sys.modules['indextts.infer_v2']=inference
soundfile=types.ModuleType('soundfile');soundfile.read=lambda _:([.2],22050);soundfile.write=lambda *args,**kwargs:None;sys.modules['soundfile']=soundfile
exec(${JSON.stringify(entry)})
`;
 const result=spawnSync('python3',['-c',harness],{encoding:'utf8',env:{...process.env,MUSIC_ROOM_TTS_DIRECTORY:'/tmp/managed-speech'},input:JSON.stringify({...input,text:'正文',referencePath:'/tmp/ref.wav',outputPath:'/tmp/out.wav'})+'\n'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/TIER_FORWARDED/);}
});
test('native learned-condition interpolation preserves exact endpoints and cannot mutate resident cache values',()=>{
 const folder=mkdtempSync(join(tmpdir(),'tts-native-emotion-'));
 try{const patch=readFileSync('native/audio-cpp/tail-context-emotion-v0.9.1.patch','utf8'),start=patch.indexOf('+++ b/include/engine/models/index_tts2/emotion_strength.h\n');assert.ok(start>0);const added=patch.slice(start).split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1)).join('\n');writeFileSync(join(folder,'emotion_strength.h'),added);
  writeFileSync(join(folder,'verify.cpp'),`#include "emotion_strength.h"
#include <cassert>
#include <cmath>
int main(){using namespace engine::models::index_tts2;const std::vector<float> ref{10,-4,0},calm{2,4,0};assert(mix_reference_emotion_strength(ref,calm,1)==ref);assert(mix_reference_emotion_strength(ref,calm,0)==calm);for(float a:{.3F,.6F,1.F,.3F}){auto mixed=mix_reference_emotion_strength(ref,calm,a);assert(std::abs(mixed[0]-(2+a*8))<.00001F);assert(std::abs(mixed[1]-(4-a*8))<.00001F);}assert((ref==std::vector<float>{10,-4,0}));assert((calm==std::vector<float>{2,4,0}));bool bad=false;try{mix_reference_emotion_strength(ref,{1},.5F);}catch(...){bad=true;}assert(bad);}`);
  const compile=spawnSync('c++',['-std=c++17',join(folder,'verify.cpp'),'-o',join(folder,'verify')],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);assert.equal(spawnSync(join(folder,'verify'),[],{encoding:'utf8'}).status,0);
 }finally{rmSync(folder,{recursive:true,force:true});}
});


test('public generation schemas accept tiers without adding defaults to historical inputs',()=>{
 for(const operation of ['tts_generate','studio_generate'] as const){
  const input={soundId:'sound',voiceId:'voice',text:'正文'};
  const legacy=parseOperation(operation,input);assert.equal(Object.hasOwn(legacy,'emotionStrength'),false);
  for(const emotionStrength of ['flat','normal','strong'])assert.equal((parseOperation(operation,{...input,emotionStrength}) as {emotionStrength:string}).emotionStrength,emotionStrength);
  for(const emotionStrength of [.3,'soft',null])assert.throws(()=>parseOperation(operation,{...input,emotionStrength}));
 }
});
