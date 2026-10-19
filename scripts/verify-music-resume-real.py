"""Opt-in recovery acceptance using previously generated, real YuE2 artifacts.

Prepare injects those completed stages and fails before decoding. A separate
process must recover them and run the real MLX decoder, with earlier stages
replaced by assertions. This does not claim a new full AR/NAR generation.
"""
import os,sys,json
from pathlib import Path
from dataclasses import replace
import numpy as np

if os.environ.get('MUSIC_ROOM_RECOVERY_REAL')!='1':raise RuntimeError('Explicit real-decoder opt-in required')
repo=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(repo/'public/yue2-runtime'),str(repo/'public/yue2-score/vendor')]
from duration import install as install_duration
from recovery import install
install_duration();install()
from yue2_studio.engine import Engine,StudioPipeline
from yue2_studio.config import EngineOptions
from yue2.pipeline import SymbolicPlan,SemanticResult
from yue2.protocol import token_prefixes

mode,fixture,output=sys.argv[1:];fixture=Path(fixture);output=Path(output);output.mkdir(parents=True,exist_ok=True)
source_id='a'*32;target_id='b'*32
saved_plan=SymbolicPlan.load(fixture/'plan')
request=json.loads((fixture/'song/request.json').read_text());request['id']=source_id if mode=='prepare' else target_id
request['target_duration_seconds']=180
options=EngineOptions(precision='8bit',preset='fast',ode_steps=8,fast_numerics=True,low_memory=True,memory_budget_gib=8,require_ac=False,loras=(('ar_lora_inst_v3abc.bf16',1.0),('nar_lora_joint_v4.bf16',1.0)))

class Prepare(StudioPipeline):
 def plan(self,*,request,**kw):return replace(saved_plan,request=request,prefix=token_prefixes(request,self.tokenizer,saved_plan.abc_ids))
 def generate_semantic(self,plan,**kw):return SemanticResult(plan,np.load(fixture/'song/semantic.npy',allow_pickle=False).tolist(),{},False)
 def synthesize(self,semantic,**kw):return np.load(fixture/'song/latent.npy',allow_pickle=False)
 def decode(self,*args,**kw):raise InterruptedError('Acceptance interruption before audio export')

class Resume(StudioPipeline):
 def plan(self,*args,**kw):raise AssertionError('Recovery repeated planning')
 def generate_semantic(self,*args,**kw):raise AssertionError('Recovery repeated semantic generation')
 def synthesize(self,*args,**kw):raise AssertionError('Recovery repeated synthesis')

engine=Engine(pipeline_factory=Prepare if mode=='prepare' else Resume)
try:
 if mode=='prepare':
  try:engine.create_song(request,output/source_id,options=options)
  except InterruptedError as error:assert 'Acceptance interruption' in str(error)
  else:raise AssertionError('Fault injection did not interrupt')
  state=json.loads((output/source_id/'checkpoints/state.json').read_text());assert state['stage']=='synthesis';print('Prepared complete synthesis checkpoint from real artifacts',flush=True)
 else:
  request['resume_from']=source_id
  summary=engine.create_song(request,output/target_id,options=options)
  import soundfile as sf
  actual,rate=sf.read(summary['audio_path'],dtype='float32',always_2d=True)
  expected,expected_rate=sf.read(fixture/'song/audio.flac',dtype='float32',always_2d=True)
  assert rate==expected_rate==48000 and actual.shape==expected.shape
  difference=float(np.max(np.abs(actual-expected)));assert difference<.0001,difference
  report={'stage':'synthesis','repeatedPlanning':False,'repeatedSemantic':False,'repeatedSynthesis':False,'realDecoder':True,'seconds':len(actual)/rate,'maxSampleDifference':difference,'audioPath':summary['audio_path']}
  (output/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
finally:engine.close()
