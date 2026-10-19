"""Duration behavior with simulated planner output; no model or audio inference."""
import sys, unittest, tempfile, json
from pathlib import Path
from dataclasses import dataclass, replace
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-score/vendor'))
from duration import plan_for_duration, extend_interludes

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

def score(seconds):
 # 60 BPM, each 4/4 bar is four seconds. Native dialect groups have <= 4 bars.
 return 'X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=60\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n'+''.join('V: Vocal\nC32|\nV: Ins\nz32|\n'  for _ in range(seconds//4))

class Pipe:
 def __init__(self,outputs):self.outputs=iter(outputs);self.requests=[];self.logs=[];self.tokenizer=SimpleNamespace(encode=lambda x:list(x.encode()))
 def plan(self,**kw):
  self.requests.append(kw['request']);abc,truncated=next(self.outputs)
  return Plan(kw['request'],abc,[1,2],[0,1,2],truncated,{})
 def log(self,line):self.logs.append(line)
 def check_execution(self):pass

class DurationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.out=Path(self.tmp.name)
  self.protocol=patch.dict(sys.modules,{'yue2.protocol':SimpleNamespace(token_prefixes=lambda r,t,ids=None:[9]+(ids or []))})
  self.protocol.start();self.addCleanup(self.protocol.stop)
 def run_plan(self,pipe,request=Request(),cancelled=None):return plan_for_duration(pipe,request,None,cancelled,None,180,self.out)
 def test_short_plan_is_replanned_before_audio_and_rebound_to_original_request(self):
  p=Pipe([(score(60),False),(score(180),False)]);r=Request(lyrics='[Verse]\n原词不变')
  result=self.run_plan(p,r)
  self.assertEqual(len(p.requests),2);self.assertEqual([x.lyrics for x in p.requests],[r.lyrics]*2)
  self.assertIn('60.0 seconds',p.requests[1].style);self.assertEqual(result.request,r);self.assertEqual(result.prefix,[9,1,2])
  report=json.loads((self.out/'duration.json').read_text());self.assertEqual(report['scoreSeconds'],180);self.assertEqual(report['attempts'],2)
 def test_never_renders_after_three_bad_plans(self):
  p=Pipe([(score(60),False)]*3)
  with self.assertRaisesRegex(ValueError,'目标时长'):self.run_plan(p)
  self.assertEqual(len(p.requests),3);self.assertTrue((self.out/'duration-attempt-3/score.abc').exists())
 def test_truncated_invalid_and_outside_range_are_not_accepted(self):
  p=Pipe([(score(180),True),('not ABC',False),(score(240),False)])
  with self.assertRaisesRegex(ValueError,'目标时长'):self.run_plan(p)
 def test_given_score_is_never_rewritten(self):
  p=Pipe([(score(60),False)]);r=Request(abc=score(60))
  with self.assertRaisesRegex(ValueError,'自定义乐谱'):self.run_plan(p,r)
  self.assertEqual(len(p.requests),1)
 def test_cancel_stops_before_any_retry(self):
  p=Pipe([(score(60),False)])
  with self.assertRaises(InterruptedError):self.run_plan(p,cancelled=lambda:True)
  self.assertEqual(p.requests,[])
  p=Pipe([(score(60),False)])
  with self.assertRaises(InterruptedError):self.run_plan(p,cancelled=lambda:bool(p.requests))
  self.assertEqual(len(p.requests),1)
 def test_extend_only_complete_instrumental_interlude_preserving_sung_melody(self):
  header=score(4).split('V: Vocal\n')[0]
  # 32-second verses + 16-second interlude + 32-second verse = 80 seconds.
  vocal='V: Vocal\nC32|D32|E32|F32|\nV: Ins\nZ4|\n'
  ins='V: Vocal\n"C"z32|z32|z32|z32|\nV: Ins\nC32|E32|G32|C32|\n'
  abc=header+'% verse\n'+vocal*2+'% interlude\n'+ins+'% chorus\n'+vocal*2
  tokenizer=SimpleNamespace(encode=lambda x:[1]*(len(x)//4))
  result=extend_interludes(abc,120,tokenizer)
  self.assertIsNotNone(result);self.assertEqual(result['afterSeconds'],112)
  self.assertEqual(result['abc'].count('% interlude'),1);self.assertEqual(result['repetitions'],[{'section':1,'repeats':2}])
  self.assertIsNone(extend_interludes(abc.replace('"C"z32','"C"C32'),120,tokenizer),'never repeat a sung phrase')
  self.assertIsNone(extend_interludes(abc,300,tokenizer),'never loop a short fragment indefinitely')
  self.assertIsNone(extend_interludes(abc,120,SimpleNamespace(encode=lambda x:[1]*5000)),'respect original ABC token budget')
  crossing=abc.replace('V: Ins\nZ4|\n% interlude','V: Ins\nZ3|C32-|\n% interlude')
  self.assertIsNone(extend_interludes(crossing,120,tokenizer),'never repeat across a tied note')
  p=Pipe([(abc,False)])
  r=Request(lyrics='[Verse]\n歌词原文\n[Chorus]\n不改演唱旋律')
  result=plan_for_duration(p,r,None,None,None,120,self.out)
  self.assertEqual(result.request.lyrics,r.lyrics);self.assertEqual(len(p.requests),1)
  evidence=json.loads((self.out/'duration.json').read_text())
  self.assertEqual(evidence['plans'][0]['arrangement']['beforeSeconds'],80)
  self.assertEqual(evidence['scoreSeconds'],112)

if __name__=='__main__':unittest.main()
