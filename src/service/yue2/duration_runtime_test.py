"""Duration behavior with simulated planner output; no model or audio inference."""
import sys, unittest, tempfile, json
from pathlib import Path
from dataclasses import dataclass, replace
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public/yue2-score/vendor'))
from duration import plan_for_duration, validate_audio_duration, within_target

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
 def test_explicit_duration_retry_uses_measured_error_to_obtain_an_in_range_score(self):
  class ResponsivePipe(Pipe):
   def plan(self,**kw):
    self.requests.append(kw['request']);self.samplings.append(kw['abc_sampling'])
    # A controlled planner that needs a concrete duration correction, not a new seed.
    corrected='60.0 seconds' in kw['request'].style and '15.0 bars' in kw['request'].style
    return Plan(kw['request'],score(60 if corrected else 112),[1,2],[0,1,2])
  p=ResponsivePipe([]);native=Request(style='Acoustic piano and bass; natural ending.')
  result=plan_for_duration(p,native,None,None,None,60,self.out)
  self.assertEqual(result.abc,score(60));self.assertEqual(result.request,native)
  self.assertEqual(p.requests[0],native);self.assertEqual(p.requests[1].lyrics,native.lyrics)
  self.assertTrue(p.requests[1].style.startswith(native.style))
  self.assertIn('112.0 seconds',p.requests[1].style)
  self.assertIn('60.0 quarter-note beats',p.requests[1].style)
  self.assertIn('Do not change tempo',p.requests[1].style)
  self.assertEqual([r.seed for r in p.requests],[42,43])
  self.assertEqual(result.prefix,[9,1,2])
  report=json.loads((self.out/'duration.json').read_text())
  self.assertTrue(report['accepted']);self.assertEqual(report['selectedAttempt'],2)
  self.assertEqual(report['plans'][1]['durationFeedback']['previousSeconds'],112)
 def test_feedback_is_latest_only_and_does_not_rewrite_score_or_lyrics(self):
  p=Pipe([(score(60),False),(score(240),False),(score(180),False)])
  native=Request(style='Folk, natural ending.',lyrics='[Verse]\n原词不增删')
  result=self.run_plan(p,native)
  self.assertEqual([r.lyrics for r in p.requests],[native.lyrics]*3)
  self.assertEqual(p.requests[2].style.count('Duration correction:'),1)
  self.assertIn('240.0 seconds',p.requests[2].style)
  self.assertNotIn('previous score was 60.0 seconds',p.requests[2].style)
  self.assertEqual(result.abc,score(180));self.assertEqual(result.request,native)
 def test_feedback_uses_score_tempo_and_meter_and_preserves_context_budget(self):
  # 3/4 at 90 BPM: 60 seconds needs 90 quarter beats / 30 bars.
  abc=score(224).replace('M:4/4','M:3/4').replace('Q:1/4=60','Q:1/4=90').replace('C32|','C24|').replace('z32|','z24|')
  p=Pipe([(abc,False),(score(60),False)])
  plan_for_duration(p,Request(),None,None,None,60,self.out)
  self.assertIn('90.0 quarter-note beats',p.requests[1].style)
  self.assertIn('30.0 bars in 3/4 at 90 BPM',p.requests[1].style)
  # An unusually long prompt must not acquire unreserved tokens on a retry.
  protocol=sys.modules['yue2.protocol']
  with patch.object(protocol,'token_prefixes',lambda r,t,ids=None:list(range(len(r.style))),create=True):
   p=Pipe([(score(112),False),(score(60),False)])
   p.generation_config=SimpleNamespace(abc=Sampling(),semantic=SimpleNamespace(max_tokens=9000),context=24576)
   native=Request(style='x'*(24576-9000-4096-2))
   result=plan_for_duration(p,native,None,None,None,60,self.out)
   self.assertEqual([r.style for r in p.requests],[native.style]*2)
   self.assertEqual(result.request,native)
   report=json.loads((self.out/'duration.json').read_text())
   self.assertEqual(report['plans'][1]['durationFeedback']['omitted'],'context_budget')
 def test_auto_and_invalid_scores_do_not_receive_duration_feedback(self):
  for target in (None,60):
   p=Pipe([('invalid',False),(score(60),False)])
   plan_for_duration(p,Request(),None,None,None,target,self.out)
   self.assertEqual([r.style for r in p.requests],[Request().style]*2)
 def test_short_complete_plan_replans_until_target_met_without_changing_lyrics(self):
  p=Pipe([(score(60),False),(score(180),False)]);r=Request(lyrics='[Verse]\n原词不变')
  result=self.run_plan(p,r)
  self.assertEqual(len(p.requests),2);self.assertEqual([x.lyrics for x in p.requests],[r.lyrics]*2)
  self.assertEqual(result.abc,score(180));self.assertEqual(result.request,r);self.assertEqual(result.prefix,[9,1,2])
  report=json.loads((self.out/'duration.json').read_text());self.assertEqual(report['scoreSeconds'],180);self.assertTrue(report['withinTarget'])
 def test_latin_regression_truncated_then_63_seconds_does_not_succeed_for_four_minutes(self):
  short=score(136).replace('Q:1/4=60','Q:1/4=128')
  p=Pipe([(score(240),True),(short,False),(score(240),False)])
  result=plan_for_duration(p,Request(),None,None,None,240,self.out)
  self.assertEqual(result.abc,score(240));self.assertEqual(len(p.requests),3)
  report=json.loads((self.out/'duration.json').read_text());self.assertEqual(report['plans'][1]['scoreSeconds'],63.75);self.assertIsNotNone(report['plans'][1]['problem']);self.assertEqual(report['selectedAttempt'],3)
 def test_complete_off_target_plan_cannot_fall_back_when_later_attempts_truncate(self):
  p=Pipe([(score(224),False),(score(180),True),(score(180),True)])
  with self.assertRaisesRegex(ValueError,'目标时长'):self.run_plan(p)
  report=json.loads((self.out/'duration.json').read_text());self.assertFalse(report['accepted']);self.assertEqual(report['attempts'],3)
 def test_all_short_or_long_plans_fail_after_three_attempts(self):
  for seconds in (60,240):
   p=Pipe([(score(seconds),False)]*3)
   with self.assertRaisesRegex(ValueError,'目标时长'):self.run_plan(p)
   self.assertEqual(len(p.requests),3)
   report=json.loads((self.out/'duration.json').read_text());self.assertFalse(report['accepted']);self.assertFalse(report['withinTarget'])
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
  p=Pipe([(score(180),True),(score(180),False)])
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
 def test_given_score_must_meet_target_and_is_never_rewritten(self):
  for seconds in (60,180,240):
   p=Pipe([(score(seconds),False)]);r=Request(abc=score(seconds))
   if seconds==180:self.assertEqual(self.run_plan(p,r).abc,r.abc)
   else:
    with self.assertRaisesRegex(ValueError,'自定义乐谱.*目标时长'):self.run_plan(p,r)
   self.assertEqual(len(p.requests),1)
 def test_preserves_the_source_for_duration_and_sends_only_accompaniment_to_the_model(self):
  both=score(60).replace('C32|','"C"z32|').replace('V: Ins\nz32|','V: Ins\nE32|')
  both=both.replace('V: Vocal\n', '% verse\nV: Vocal\n',1)
  both=both.replace('V: Vocal\n"C"z32|\nV: Ins\nE32|','V: Vocal\nM:4/4\nK:G\n"C"z32|\nV: Ins\nM:4/4\nK:G\nE32|',1)
  effective='\n'.join(line for line in both.split('\n')[:5]+both.split('\n')[6:8])+'\n% verse\n'
  effective+=('V: Ins\nM:4/4\nK:G\nE32|\n'+'V: Ins\nE32|\n'*14).rstrip()
  request=Request(abc=both,lyrics='[Verse]\n原词不变')
  for target in (None,60,180):
   p=Pipe([(effective,False)])
   if target==180:
    with self.assertRaisesRegex(ValueError,'自定义乐谱.*目标时长'):
     plan_for_duration(p,request,None,None,None,target,self.out,omit_vocal_rests=True)
    continue
   result=plan_for_duration(p,request,None,None,None,target,self.out,omit_vocal_rests=True)
   self.assertEqual(p.requests,[replace(request,abc=effective)])
   self.assertEqual(result.request,request)
   self.assertEqual(result.abc,effective)
   report=json.loads((self.out/'duration.json').read_text())
   self.assertEqual(report['scoreSeconds'],60)
   self.assertTrue(report['accepted'])
   self.assertTrue(report['vocalRestsOmitted'])
  for unusable in (score(60),both.replace('E32|','z32|'),'invalid'):
   p=Pipe([])
   with self.assertRaises(ValueError):
    plan_for_duration(p,replace(request,abc=unusable),None,None,None,None,self.out,omit_vocal_rests=True)
   self.assertEqual(p.requests,[])
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
 def test_target_tolerance_accepts_only_in_range_scores(self):
  for seconds in (156,180,204):
   p=Pipe([(score(seconds),False)])
   self.assertEqual(self.run_plan(p).abc,score(seconds));self.assertEqual(len(p.requests),1)
 def test_audio_duration_rejects_early_stop_and_preserves_diagnostics(self):
  for seconds in (59.1586667,300,None,float('nan')):
   summary={'status':'complete','seconds':seconds,'audio_path':'original.flac'}
   with self.assertRaisesRegex(ValueError,'音频实际时长.*目标时长 240'):validate_audio_duration(summary,240,self.out)
   self.assertEqual(summary['status'],'failed');self.assertEqual(summary['audio_path'],'original.flac')
   report=json.loads((self.out/'duration.json').read_text());self.assertFalse(report['audioWithinTarget'])
 def test_audio_duration_accepts_tolerance_boundaries_and_auto(self):
  for target in (60,120,180,240,300):
   for seconds in (target*.85,target,target*1.15):
    self.assertTrue(within_target(seconds,target))
    summary={'status':'complete','seconds':seconds}
    self.assertIs(validate_audio_duration(summary,target,self.out),summary)
   self.assertFalse(within_target(target*.85-.001,target));self.assertFalse(within_target(target*1.15+.001,target))
  summary={'status':'complete','seconds':59}
  self.assertIs(validate_audio_duration(summary,None,self.out),summary)
 def test_installed_engine_hook_cannot_return_success_for_short_audio(self):
  from contextlib import nullcontext
  from duration import install
  class Engine:
   def _split_request(self,fields):return fields,{},None,None
   def resolve_loras(self,loras):return []
   def ensure(self,*args):return SimpleNamespace(set_loras=lambda _:None)
   def _busy(self,pipe):return nullcontext()
   def _run_create(self,*args,**kw):
    self.policy=kw['config_extra']['music_room_duration']
    return {'status':'complete','seconds':self.seconds}
  jobs=SimpleNamespace(CreateParams=object,_PARAM_MODELS={},_create_params_dict=lambda p,seed:{},engine_request=lambda j:{})
  worker=SimpleNamespace()
  modules={'yue2_studio':SimpleNamespace(jobs=jobs,worker=worker),'yue2_studio.engine':SimpleNamespace(Engine=Engine)}
  with patch.dict(sys.modules,modules),patch.object(sys.modules['yue2.protocol'],'SongRequest',lambda **kw:None,create=True):
   install();engine=Engine();engine.seconds=59
   with self.assertRaisesRegex(ValueError,'音频实际时长'):engine.create_song({'target_duration_seconds':240},self.out,options=SimpleNamespace(loras=[]))
   self.assertEqual(engine.policy['version'],6)
   self.assertEqual(engine.policy['feedbackTokens'],512)
   engine.seconds=236.84
   self.assertEqual(engine.create_song({'target_duration_seconds':240},self.out,options=SimpleNamespace(loras=[]))['status'],'complete')
 def test_auto_duration_accepts_any_complete_score(self):
  for seconds in (60,240):
   p=Pipe([(score(seconds),False)])
   result=plan_for_duration(p,Request(),None,None,None,None,self.out)
   self.assertEqual(result.abc,score(seconds));self.assertEqual(len(p.requests),1)

if __name__=='__main__':unittest.main()
