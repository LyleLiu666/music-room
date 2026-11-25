"""Music Room's bounded duration planner for the pinned YuE2 Studio runtime.

Explicit target durations gate both planning and completed audio.
Automatic duration preserves free-length output. The submitted two-voice score
is used for validation even when its silent vocal voice is omitted for the model.
"""
import json,math
from dataclasses import replace,asdict
from pathlib import Path
from typing import Literal
from abc_tools import accompaniment_only_abc, parse_abc

TARGETS=(60,120,180,240,300)
TOLERANCE=.15
MAX_ATTEMPTS=3
# Already reserved by the input inspector for generated-score prefixes.
FEEDBACK_TOKENS=512
# Decoder failures change sampling; measured duration misses also receive feedback.
# First-pass sampling and all token budgets stay unchanged.
RETRY_SAMPLING=(
 dict(temperature=.85,top_p=.95,top_k=60,repetition_penalty=1.02),
 dict(temperature=1.,top_p=.98,top_k=100,repetition_penalty=1.04),
)

def score_seconds(abc):
 score=parse_abc(abc)
 return float(score.voices['Vocal'].time*60/score.bpm)

def within_target(seconds,target):
 return math.isfinite(seconds) and seconds>0 and (target is None or target*(1-TOLERANCE)<=seconds<=target*(1+TOLERANCE))

def duration_correction(previous,target):
 """Use only a complete, valid off-target score; never repair or rewrite it."""
 if target is None or not previous or not previous.get('arrangement'):return None
 seconds=previous['scoreSeconds'];arrangement=previous['arrangement']
 if seconds is None or within_target(seconds,target):return None
 bpm=arrangement['bpm'];n,d=arrangement['meter'];beats=target*bpm/60;bars=beats/(4*n/d)
 feedback=dict(previousSeconds=seconds,targetSeconds=target,bpm=bpm,meter=[n,d],quarterBeats=beats,bars=bars)
 direction='Use fewer bars and shorter sections.' if seconds>target else 'Develop the themes across more bars and complete sections.'
 text=(f'\n\nDuration correction: the previous score was {seconds:.1f} seconds; the target is {target:.1f} seconds. '
       f'Plan approximately {beats:.1f} quarter-note beats, or {bars:.1f} bars in {n}/{d} at {bpm} BPM, across the whole piece including the outro. '
       f'{direction} Do not change tempo merely to fill time. Preserve all supplied lyric words and their order; do not sing these instructions. Write a new complete score with a resolved ending.')
 return text,feedback

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

def plan_for_duration(pipe,native,sampling,cancelled,on_token,target,out_dir,*,omit_vocal_rests=False):
 from yue2.protocol import token_prefixes,resolve_sampling
 if target is not None and (type(target) is not int or target not in TARGETS): raise ValueError('目标时长请选择约 1–5 分钟')
 out_dir=Path(out_dir);out_dir.mkdir(parents=True,exist_ok=True)
 source_score=None
 if omit_vocal_rests:
  source_score=parse_abc((native.abc or '').strip())
  accompaniment=accompaniment_only_abc(source_score)
  if not accompaniment:raise ValueError('只有人声全休止且伴奏有音符时，才可略过人声轨。')
  model_request=replace(native,abc=accompaniment)
 else:model_request=native
 score_details={'vocalRestsOmitted':True} if omit_vocal_rests else {}
 attempts=[];base_sampling=resolve_sampling(sampling,pipe.generation_config.abc)
 def accept(plan,seconds,selected):
  within=within_target(seconds,target)
  (out_dir/'duration.json').write_text(json.dumps(dict(targetSeconds=target,tolerance=TOLERANCE,attempts=len(attempts),scoreSeconds=seconds,accepted=True,withinTarget=within,selectedAttempt=selected,plans=attempts,**score_details),ensure_ascii=False,indent=2))
  if omit_vocal_rests:pipe.log(f'乐谱预计 {seconds:.0f} 秒，略过全休止人声轨，按伴奏谱生成音频')
  else:pipe.log(f'完整乐谱预计 {seconds:.0f} 秒，开始按谱生成音频')
  return replace(plan,request=native,prefix=token_prefixes(native,pipe.tokenizer,plan.abc_ids))
 for attempt in range(1,(1 if native.abc else MAX_ATTEMPTS)+1):
  pipe.check_execution()
  if cancelled and cancelled(): raise InterruptedError('Cancelled during duration planning')
  # The first seed is untouched; bounded subsequent seeds make retries reproducible.
  request=model_request if attempt==1 else replace(native,seed=(native.seed+attempt-1)%2147483648)
  attempt_sampling=base_sampling if attempt==1 else replace(base_sampling,**{name:max(getattr(base_sampling,name),value) for name,value in RETRY_SAMPLING[attempt-2].items()})
  feedback=None;correction=duration_correction(attempts[-1] if attempts else None,target)
  if correction:
   text,feedback=correction;candidate=replace(request,style=native.style+text)
   original_tokens=len(token_prefixes(request,pipe.tokenizer));candidate_tokens=len(token_prefixes(candidate,pipe.tokenizer))
   config=pipe.generation_config;semantic_tokens=getattr(getattr(config,'semantic',None),'max_tokens',9000)
   if candidate_tokens-original_tokens<=FEEDBACK_TOKENS and candidate_tokens+attempt_sampling.max_tokens+2+semantic_tokens<=getattr(config,'context',24576):
    request=candidate
   else:feedback={**feedback,'omitted':'context_budget'}
  pipe.log(f'正在规划完整乐谱（{attempt}/{MAX_ATTEMPTS}）')
  plan=pipe.plan(request=request,abc_sampling=attempt_sampling,cancelled=cancelled,on_token=on_token)
  pipe.check_execution()
  if cancelled and cancelled():raise InterruptedError('Cancelled during planning')
  plan.save(out_dir/f'duration-attempt-{attempt}')
  seconds=None;problem=None;arrangement=None
  try:
   if plan.truncated: raise ValueError('乐谱写作达到长度上限')
   score=source_score if omit_vocal_rests else parse_abc(plan.abc or '')
   seconds=float(score.voices['Vocal'].time*60/score.bpm)
   if not math.isfinite(seconds) or seconds<=0:raise ValueError('乐谱时长无效')
   arrangement=dict(bpm=score.bpm,meter=list(score.voices['Vocal'].meter))
   if not within_target(seconds,target):raise ValueError(f'乐谱预计 {seconds:.1f} 秒，未达到目标时长 {target} 秒（允许偏差 ±15%）')
  except ValueError as exc: problem=str(exc)
  attempts.append(dict(attempt=attempt,seed=request.seed,sampling=asdict(attempt_sampling),scoreSeconds=seconds,problem=problem,arrangement=arrangement,durationFeedback=feedback))
  evidence=dict(targetSeconds=target,tolerance=TOLERANCE,attempts=attempt,scoreSeconds=seconds,accepted=problem is None,withinTarget=seconds is not None and within_target(seconds,target),plans=attempts,**score_details)
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
  omit_vocal_rests:bool=False
 jobs.CreateParams=DurationCreateParams
 jobs._PARAM_MODELS['create']=DurationCreateParams
 original_params=jobs._create_params_dict
 def params(p,seed):
  result=original_params(p,seed)
  target=getattr(p,'target_duration_seconds',None)
  if target is not None:result['target_duration_seconds']=target
  if getattr(p,'omit_vocal_rests',False):result['omit_vocal_rests']=True
  return result
 jobs._create_params_dict=params
 original_request=jobs.engine_request
 def engine_request(job):
  result=original_request(job)
  if job.params.get('target_duration_seconds') is not None:result['target_duration_seconds']=job.params['target_duration_seconds']
  if job.params.get('omit_vocal_rests'):result['omit_vocal_rests']=True
  return result
 jobs.engine_request=worker.engine_request=engine_request
 def create_song(self,request,out_dir,*,options,on_event=None,cancelled=None):
  fields=dict(request);target=fields.pop('target_duration_seconds',None)
  omit_vocal_rests=fields.pop('omit_vocal_rests',False)
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
    return plan_for_duration(pipe,native,sampling,cancelled,observer,target,out_dir,omit_vocal_rests=omit_vocal_rests)
   duration_config={'targetSeconds':target,'tolerance':TOLERANCE,'maxAttempts':MAX_ATTEMPTS,'retrySampling':RETRY_SAMPLING,'feedbackTokens':FEEDBACK_TOKENS,'version':6}
   if omit_vocal_rests:duration_config['vocalRestsOmitted']=True
   summary=self._run_create(pipe,fields,generation,abc_sampling,semantic_sampling,out_dir,options=options,cancelled=cancelled,planner=planner,config_extra={'music_room_duration':duration_config})
   return validate_audio_duration(summary,target,out_dir)
 Engine.create_song=create_song
 Engine._music_room_duration=True
