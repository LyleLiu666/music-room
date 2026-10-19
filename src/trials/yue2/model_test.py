"""Prove stage boundaries without allocating model memory."""
import json,sys,tempfile,types,unittest
from pathlib import Path
from contextlib import nullcontext
from unittest.mock import patch
from model import execute
class ModelTests(unittest.TestCase):
 def test_plan_cannot_enter_audio_stages(self):
  calls=[]
  class Plan:
   truncated=False
   def save(self,path): calls.append('save');path.mkdir();(path/'score.abc').write_text('score')
  class Pipe:
   weights={}
   def set_loras(self,x): pass
   def build_request(self,**x): return types.SimpleNamespace(to_dict=lambda:x)
   def plan(self,**kw): calls.append('plan');return Plan()
   def token_observer(self,**kw): return None
   def effective_config(self,*args): return {}
   def generate_semantic(self,*args): raise AssertionError('plan-only entered audio stage')
  class Engine:
   def _split_request(self,r): return r,{},None,None
   def ensure(self,*args): return Pipe()
   def _busy(self,p): return nullcontext()
   def resolve_loras(self,x): return x
  protocol=types.ModuleType('yue2.protocol');protocol.GenerationConfig=types.SimpleNamespace(from_dict=lambda d:d);protocol.SongRequest=lambda **x:x
  with tempfile.TemporaryDirectory() as d,patch.dict(sys.modules,{'yue2':types.ModuleType('yue2'),'yue2.protocol':protocol}):
   execute(Engine(),types.SimpleNamespace(loras=[],ode_steps=8,fast_numerics=False),{'kind':'plan','request':{'params':{'style':'piano'}}},Path(d))
   self.assertEqual(calls,['plan','save']);self.assertFalse((Path(d)/'song').exists())
   Plan.truncated=True
   second=Path(d)/'truncated';second.mkdir()
   with self.assertRaisesRegex(ValueError,'长度上限'): execute(Engine(),types.SimpleNamespace(loras=[],ode_steps=8,fast_numerics=False),{'kind':'plan','request':{'params':{'style':'piano'}}},second)
   self.assertTrue((second/'plan/score.abc').exists());self.assertFalse((second/'song').exists())
 def test_render_passes_exact_score(self):
  class Engine:
   def create_song(self,request,*args,**kwargs): self.request=request
  engine=Engine();execute(engine,None,{'kind':'render','request':{'params':{'abc':'exact score'}}},Path('/unused'))
  self.assertEqual(engine.request['abc'],'exact score')
  with self.assertRaises(ValueError): execute(engine,None,{'kind':'render','request':{'params':{}}},Path('/unused'))
if __name__=='__main__': unittest.main()
