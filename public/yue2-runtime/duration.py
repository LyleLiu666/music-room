"""Music Room's bounded duration planner for the pinned YuE2 Studio runtime.

Explicit target durations gate both planning and completed audio.
Automatic duration preserves free-length output; supplied scores are never rewritten.
"""
import json,math
from dataclasses import replace,asdict
from pathlib import Path
from typing import Literal
from abc_tools import parse_abc

TARGETS=(60,120,180,240,300)
TOLERANCE=.15
MAX_ATTEMPTS=3
# A failed decoder run needs a different sampling distribution, not more prose
# in the user's style. First-pass sampling and all token budgets stay unchanged.
RETRY_SAMPLING=(
 dict(temperature=.85,top_p=.95,top_k=60,repetition_penalty=1.02),
 dict(temperature=1.,top_p=.98,top_k=100,repetition_penalty=1.04),
)

def score_seconds(abc):
 score=parse_abc(abc)
 return float(score.voices['Vocal'].time*60/score.bpm)

def within_target(seconds,target):
 return math.isfinite(seconds) and seconds>0 and (target is None or target*(1-TOLERANCE)<=seconds<=target*(1+TOLERANCE))

def validate_audio_duration(summary,target,out_dir):
 if target is None:return summary
 seconds=summary.get('seconds')
 valid=type(seconds) in (int,float) and within_target(seconds,target)
 path=Path(out_dir)/'duration.json'
 report=json.loads(path.read_text()) if path.exists() else {}
 report.update(audioSeconds=seconds if type(seconds) in (int,float) and math.isfinite(seconds) else None,audioWithinTarget=valid)
 path.write_text(json.dumps(report,ensure_ascii=False,indent=2))
 if not valid:
  actual=f'{seconds:.1f} 秒' if isinstance(seconds,(int,float)) and math.isfinite(seconds) else '未知'
  message=f'音频实际时长 {actual}，未达到目标时长 {target} 秒（允许偏差 ±15%）。文件已保留用于排查，本次生成未通过时长检查。'
  summary.update(status='failed',error=message)
  (Path(out_dir)/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
  raise ValueError(message)
 return summary

def plan_for_duration(pipe,native,sampling,cancelled,on_token,target,out_dir):
 from yue2.protocol import token_prefixes,resolve_sampling
 if target is not None and (type(target) is not int or target not in TARGETS): raise ValueError('目标时长请选择约 1–5 分钟')
 out_dir=Path(out_dir);out_dir.mkdir(parents=True,exist_ok=True)
 attempts=[];base_sampling=resolve_sampling(sampling,pipe.generation_config.abc)
 def accept(plan,seconds,selected):
  within=within_target(seconds,target)
  (out_dir/'duration.json').write_text(json.dumps(dict(targetSeconds=target,tolerance=TOLERANCE,attempts=len(attempts),scoreSeconds=seconds,accepted=True,withinTarget=within,selectedAttempt=selected,plans=attempts),ensure_ascii=False,indent=2))
  pipe.log(f'完整乐谱预计 {seconds:.0f} 秒，开始按谱生成音频')
  return replace(plan,request=native,prefix=token_prefixes(native,pipe.tokenizer,plan.abc_ids))
 for attempt in range(1,(1 if native.abc else MAX_ATTEMPTS)+1):
  pipe.check_execution()
  if cancelled and cancelled(): raise InterruptedError('Cancelled during duration planning')
  # The first seed is untouched; bounded subsequent seeds make retries reproducible.
  request=native if attempt==1 else replace(native,seed=(native.seed+attempt-1)%2147483648)
  attempt_sampling=base_sampling if attempt==1 else replace(base_sampling,**{name:max(getattr(base_sampling,name),value) for name,value in RETRY_SAMPLING[attempt-2].items()})
  pipe.log(f'正在规划完整乐谱（{attempt}/{MAX_ATTEMPTS}）')
  plan=pipe.plan(request=request,abc_sampling=attempt_sampling,cancelled=cancelled,on_token=on_token)
  pipe.check_execution()
  if cancelled and cancelled():raise InterruptedError('Cancelled during planning')
  plan.save(out_dir/f'duration-attempt-{attempt}')
  seconds=None;problem=None;arrangement=None
  try:
   if plan.truncated: raise ValueError('乐谱写作达到长度上限')
   seconds=score_seconds(plan.abc or '')
   if not math.isfinite(seconds) or seconds<=0:raise ValueError('乐谱时长无效')
   if not within_target(seconds,target):raise ValueError(f'乐谱预计 {seconds:.1f} 秒，未达到目标时长 {target} 秒（允许偏差 ±15%）')
  except ValueError as exc: problem=str(exc)
  attempts.append(dict(attempt=attempt,seed=request.seed,sampling=asdict(attempt_sampling),scoreSeconds=seconds,problem=problem,arrangement=arrangement))
  evidence=dict(targetSeconds=target,tolerance=TOLERANCE,attempts=attempt,scoreSeconds=seconds,accepted=problem is None,withinTarget=seconds is not None and within_target(seconds,target),plans=attempts)
  (out_dir/'duration.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
  if problem is None:return accept(plan,seconds,attempt)
  if native.abc:raise ValueError(f'自定义乐谱无法检查（{problem}），请检查乐谱。')
  pipe.log(f'重新规划乐谱：{problem}')
 raise ValueError('模型在三次规划后仍未达到目标时长或写出完整乐谱。未进入音频合成；请调整编排或更换随机种子。' if target is not None else '模型在三次规划后仍未写出完整乐谱（输出达到长度上限或乐谱无效）。未进入音频合成；这不是提示词填写不完整。可更换随机种子后重新生成，或提供完整乐谱。')

def install():
 """Extend the pinned API protocol and engine hook before starting its single worker."""
 from yue2_studio import jobs,worker
 from yue2_studio.engine import Engine
 from yue2.protocol import SongRequest
 if getattr(Engine,'_music_room_duration',False):return
 base_params=jobs.CreateParams
 class DurationCreateParams(base_params):
  target_duration_seconds:Literal[60,120,180,240,300]|None=None
 jobs.CreateParams=DurationCreateParams
 jobs._PARAM_MODELS['create']=DurationCreateParams
 original_params=jobs._create_params_dict
 def params(p,seed):
  result=original_params(p,seed)
  target=getattr(p,'target_duration_seconds',None)
  if target is not None:result['target_duration_seconds']=target
  return result
 jobs._create_params_dict=params
 original_request=jobs.engine_request
 def engine_request(job):
  result=original_request(job)
  if job.params.get('target_duration_seconds') is not None:result['target_duration_seconds']=job.params['target_duration_seconds']
  return result
 jobs.engine_request=worker.engine_request=engine_request
 def create_song(self,request,out_dir,*,options,on_event=None,cancelled=None):
  fields=dict(request);target=fields.pop('target_duration_seconds',None)
  if target is not None and (type(target) is not int or target not in TARGETS):raise ValueError('目标时长请选择约 1–5 分钟')
  fields,generation,abc_sampling,semantic_sampling=self._split_request(fields)
  SongRequest(**fields)
  out_dir=Path(out_dir)
  if (out_dir/'song').exists() and any((out_dir/'song').iterdir()):raise FileExistsError('Song directory is not empty')
  loras=self.resolve_loras(options.loras)
  pipe=self.ensure(options,on_event)
  with self._busy(pipe):
   pipe.set_loras(loras)
   def planner(pipe,native,sampling,cancelled,observer):
    return plan_for_duration(pipe,native,sampling,cancelled,observer,target,out_dir)
   summary=self._run_create(pipe,fields,generation,abc_sampling,semantic_sampling,out_dir,options=options,cancelled=cancelled,planner=planner,config_extra={'music_room_duration':{'targetSeconds':target,'tolerance':TOLERANCE,'maxAttempts':MAX_ATTEMPTS,'retrySampling':RETRY_SAMPLING,'version':5}})
   return validate_audio_duration(summary,target,out_dir)
 Engine.create_song=create_song
 Engine._music_room_duration=True
