"""Stage interruption/restart tests with the pinned protocol, no model loading."""
import sys, tempfile, unittest, json
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from yue2.pipeline import SymbolicPlan, SemanticResult
from yue2.protocol import SongRequest, token_prefixes
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-runtime'))
from recovery import checkpointed

class Pipe:
 def __init__(self):
  self.tokenizer=SimpleNamespace(encode=lambda s:list(s.encode()));self.weights={'mot':'fixed','vae':'fixed'};self.calls=[]
 def check_execution(self):pass
 def log(self,s):pass
 def effective_config(self,*args):return {'preset':'fast','memory_budget_gib':getattr(self,'budget',8)}
 def plan(self,request,**kw):
  self.calls.append('plan');return SymbolicPlan(request,'ABC',[1],token_prefixes(request,self.tokenizer,[1]),{},False)
 def generate_semantic(self,plan,**kw):self.calls.append('semantic');return SemanticResult(plan,[1,2,3],{},False)
 def synthesize(self,semantic,**kw):self.calls.append('synthesis');return np.full((len(semantic.tokens),64),.25,dtype=np.float32)

def run(pipe,out,source=None,request=None,stop=None):
 native=request or SongRequest('piano','[instrumental]',seed=42,id=out.name)
 with checkpointed(pipe,out,source,None,{}) as planner:
  plan=planner(pipe,native,None,None,None)
  if stop=='plan':raise InterruptedError('plan')
  semantic=pipe.generate_semantic(plan)
  if stop=='semantic':raise InterruptedError('semantic')
  latent=pipe.synthesize(semantic)
  if stop=='decode':raise InterruptedError('decode')
  return plan,semantic,latent

class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.a=self.root/'a';self.b=self.root/'b';self.a.mkdir();self.b.mkdir()
 def test_decode_failure_reuses_complete_synthesis_after_process_restart(self):
  first=Pipe()
  with self.assertRaises(InterruptedError):run(first,self.a,stop='decode')
  second=Pipe();plan,semantic,latent=run(second,self.b,self.a)
  self.assertEqual(second.calls,[]);self.assertEqual(plan.request.id,'b');self.assertEqual(semantic.tokens,[1,2,3]);np.testing.assert_array_equal(latent,np.full((3,64),.25,dtype=np.float32))
  self.assertEqual(json.loads((self.a/'checkpoints/state.json').read_text())['stage'],'synthesis')
  self.assertEqual(json.loads((self.b/'checkpoints/state.json').read_text())['stage'],'synthesis')
 def test_interrupted_synthesis_restarts_only_that_stage(self):
  with self.assertRaises(InterruptedError):run(Pipe(),self.a,stop='semantic')
  p=Pipe();run(p,self.b,self.a);self.assertEqual(p.calls,['synthesis'])
 def test_plan_only_and_legacy_saved_plan_do_not_rewrite_the_score(self):
  p=Pipe();r=SongRequest('piano','[instrumental]',seed=42,id='a');p.plan(r).save(self.a/'plan')
  q=Pipe();plan,_,_=run(q,self.b,self.a);self.assertEqual(q.calls,['semantic','synthesis']);self.assertEqual(plan.abc,'ABC')
 def test_changed_request_or_configuration_refuses_cache(self):
  with self.assertRaises(InterruptedError):run(Pipe(),self.a,stop='decode')
  with self.assertRaisesRegex(ValueError,'不一致'):run(Pipe(),self.b,self.a,SongRequest('changed','[instrumental]',seed=42,id='b'))
  p=Pipe();p.weights={'mot':'different','vae':'fixed'}
  with self.assertRaisesRegex(ValueError,'不一致'):run(p,self.b,self.a)
  self.assertEqual(p.calls,[])
 def test_corrupt_or_linked_cache_is_not_silently_used(self):
  with self.assertRaises(InterruptedError):run(Pipe(),self.a,stop='decode')
  path=self.a/'checkpoints/synthesis/latents.npy';data=path.read_bytes();path.write_bytes(b'broken')
  with self.assertRaisesRegex(ValueError,'校验'):run(Pipe(),self.b,self.a)
  path.unlink();outside=self.root/'outside';outside.write_bytes(data);path.symlink_to(outside)
  with self.assertRaisesRegex(ValueError,'链接'):run(Pipe(),self.b,self.a)
 def test_memory_budget_change_does_not_invalidate_generated_music(self):
  with self.assertRaises(InterruptedError):run(Pipe(),self.a,stop='decode')
  p=Pipe();p.budget=12;run(p,self.b,self.a);self.assertEqual(p.calls,[])
 def test_protocol_extensions_preserve_duration_and_resume_together(self):
  sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-score/vendor'))
  from duration import install as install_duration
  from recovery import install
  install_duration();install()
  from yue2_studio import jobs,worker
  params=jobs.CreateParams(style='piano',lyrics='[instrumental]',seed=42,target_duration_seconds=180,resume_from='a'*32)
  values=jobs._create_params_dict(params,42)
  job=jobs.Job(id='b'*32,kind='create',status='queued',preset='fast',precision='8bit',ode_steps=8,seed=42,params=values,created_at='now')
  for request in [jobs.engine_request(job),worker.engine_request(job)]:
   self.assertEqual(request['resume_from'],'a'*32);self.assertEqual(request['target_duration_seconds'],180);self.assertEqual(request['lyrics'],'[instrumental]')
  with self.assertRaises(ValueError):jobs._create_params_dict(jobs.CreateParams(style='piano',lyrics='[instrumental]',resume_from='../wrong'),42)
 def test_cancel_is_honored_between_cached_stages(self):
  with self.assertRaises(InterruptedError):run(Pipe(),self.a,stop='decode')
  p=Pipe();native=SongRequest('piano','[instrumental]',seed=42,id='b')
  with checkpointed(p,self.b,self.a,None,{}) as planner:
   plan=planner(p,native,None,None,None)
   with self.assertRaises(InterruptedError):p.generate_semantic(plan,cancelled=lambda:True)
   semantic=p.generate_semantic(plan)
   with self.assertRaises(InterruptedError):p.synthesize(semantic,cancelled=lambda:True)
  self.assertEqual(json.loads((self.b/'checkpoints/state.json').read_text())['stage'],'semantic')
 def test_uncommitted_files_never_advance_the_recovery_point(self):
  with self.assertRaises(InterruptedError):run(Pipe(),self.a,stop='plan')
  (self.a/'checkpoints/synthesis').mkdir();(self.a/'checkpoints/synthesis/latents.npy').write_bytes(b'incomplete')
  p=Pipe();run(p,self.b,self.a);self.assertEqual(p.calls,['semantic','synthesis'])

if __name__=='__main__':unittest.main()
