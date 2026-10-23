"""Duration behavior with simulated planner output; no model or audio inference."""
import sys, unittest, tempfile, json
from pathlib import Path
from dataclasses import dataclass, replace
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-score/vendor'))
from duration import plan_for_duration

@dataclass(frozen=True)
class Request:
 style:str='piano'
 lyrics:str='[instrumental]'
 seed:int=42
 abc:str|None=None

@dataclass
class Plan:
 request:Request
 abc:str
 abc_ids:list
 prefix:list
 truncated:bool=False
 timing:dict=None
 def save(self,path):
  path.mkdir(parents=True,exist_ok=True);(path/'score.abc').write_text(self.abc)

@dataclass(frozen=True)
class Sampling:
 temperature:float=.7
 top_p:float=.9
 top_k:int=30
 repetition_penalty:float=1.005
 penalty_window:int=100
 min_tokens:int=32
 max_tokens:int=4096

def score(seconds):
 # 60 BPM, each 4/4 bar is four seconds. Native dialect groups have <= 4 bars.
 return 'X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=60\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n'+''.join('V: Vocal\nC32|\nV: Ins\nz32|\n'  for _ in range(seconds//4))

class Pipe:
 def __init__(self,outputs):
  self.outputs=iter(outputs);self.requests=[];self.samplings=[];self.logs=[];self.tokenizer=SimpleNamespace(encode=lambda x:list(x.encode()))
  self.generation_config=SimpleNamespace(abc=Sampling())
 def plan(self,**kw):
  self.requests.append(kw['request']);self.samplings.append(kw['abc_sampling']);abc,truncated=next(self.outputs)
  return Plan(kw['request'],abc,[1,2],[0,1,2],truncated,{})
 def log(self,line):self.logs.append(line)
 def check_execution(self):pass

class DurationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.out=Path(self.tmp.name)
  self.protocol=patch.dict(sys.modules,{'yue2.protocol':SimpleNamespace(token_prefixes=lambda r,t,ids=None:[9]+(ids or []),resolve_sampling=lambda value,default:replace(default,**value) if isinstance(value,dict) else value or default)})
  self.protocol.start();self.addCleanup(self.protocol.stop)
 def run_plan(self,pipe,request=Request(),cancelled=None):return plan_for_duration(pipe,request,None,cancelled,None,180,self.out)
 def test_short_complete_plan_is_accepted_without_duration_retries(self):
  p=Pipe([(score(60),False),(score(180),False)]);r=Request(lyrics='[Verse]\n原词不变')
  result=self.run_plan(p,r)
  self.assertEqual(len(p.requests),1);self.assertEqual([x.lyrics for x in p.requests],[r.lyrics])
  self.assertEqual(result.request,r);self.assertEqual(result.prefix,[9,1,2])
  report=json.loads((self.out/'duration.json').read_text());self.assertEqual(report['scoreSeconds'],60);self.assertEqual(report['attempts'],1)
 def test_complete_off_target_score_is_retained_when_later_attempts_truncate(self):
  p=Pipe([(score(224),False),(score(180),True),(score(180),True)])
  result=self.run_plan(p)
  self.assertEqual(result.abc,score(224));self.assertFalse(result.truncated)
  report=json.loads((self.out/'duration.json').read_text());self.assertTrue(report['accepted']);self.assertFalse(report['withinTarget']);self.assertEqual(report['selectedAttempt'],1)
 def test_all_truncated_plans_fail_after_three_bounded_sampling_attempts(self):
  p=Pipe([(score(180),True)]*3)
  with self.assertRaisesRegex(ValueError,'完整乐谱'):self.run_plan(p)
  self.assertEqual([r.seed for r in p.requests],[42,43,44])
  self.assertEqual([r.style for r in p.requests],[Request().style]*3)
  self.assertGreater(p.samplings[1].repetition_penalty,p.samplings[0].repetition_penalty)
  self.assertGreater(p.samplings[2].repetition_penalty,p.samplings[1].repetition_penalty)
  self.assertEqual([s.max_tokens for s in p.samplings],[4096]*3)
  report=json.loads((self.out/'duration.json').read_text())
  self.assertFalse(report['accepted']);self.assertEqual(report['attempts'],3)
  self.assertEqual([x['sampling']['max_tokens'] for x in report['plans']],[4096]*3)
 def test_retry_keeps_original_prompt_and_lyrics_and_does_not_reuse_looping_sampler(self):
  request=Request(style='Instrumental piano miniature, concise melody, natural ending, no vocals.')
  p=Pipe([(score(180),True),(score(60),False)])
  result=self.run_plan(p,request)
  self.assertEqual([r.style for r in p.requests],[request.style]*2)
  self.assertEqual([r.lyrics for r in p.requests],[request.lyrics]*2)
  self.assertEqual(p.samplings[0],p.generation_config.abc)
  self.assertGreater(p.samplings[1].temperature,p.samplings[0].temperature)
  self.assertGreater(p.samplings[1].top_k,p.samplings[0].top_k)
  self.assertEqual(result.request,request);self.assertFalse(result.truncated)
 def test_sampling_override_and_token_budget_are_preserved_on_first_attempt(self):
  p=Pipe([(score(180),True),(score(60),False)])
  override={'temperature':1.2,'top_k':120,'top_p':.99,'repetition_penalty':1.1,'max_tokens':1024,'min_tokens':10}
  plan_for_duration(p,Request(),override,None,None,None,self.out)
  self.assertEqual(p.samplings[0],replace(Sampling(),**override))
  self.assertEqual(p.samplings[1],p.samplings[0])
 def test_given_complete_score_is_not_rewritten_to_enforce_approximate_duration(self):
  p=Pipe([(score(60),False)]);r=Request(abc=score(60))
  self.assertEqual(self.run_plan(p,r).abc,r.abc);self.assertEqual(len(p.requests),1)
 def test_auto_duration_replans_truncated_score_without_forcing_a_duration(self):
  p=Pipe([(score(180),True),(score(120),False)])
  result=plan_for_duration(p,Request(),None,None,None,None,self.out)
  self.assertFalse(result.truncated);self.assertEqual(len(p.requests),2)
 def test_cancel_stops_before_any_retry(self):
  p=Pipe([(score(60),False)])
  with self.assertRaises(InterruptedError):self.run_plan(p,cancelled=lambda:True)
  self.assertEqual(p.requests,[])
  p=Pipe([(score(60),False)])
  with self.assertRaises(InterruptedError):self.run_plan(p,cancelled=lambda:bool(p.requests))
  self.assertEqual(len(p.requests),1)
 def test_target_is_guidance_for_shorter_and_longer_complete_scores(self):
  for seconds in (148,180,208,240):
   p=Pipe([(score(seconds),False)])
   self.assertEqual(self.run_plan(p).abc,score(seconds));self.assertEqual(len(p.requests),1)

if __name__=='__main__':unittest.main()
