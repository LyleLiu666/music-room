"""Music Room's bounded duration planner for the pinned YuE2 Studio runtime.

Only explicit target_duration_seconds activates this adapter. Existing requests retain
the upstream path. No audio cropping, resampling, lyric rewriting or token forcing.
"""
import json,re,itertools
from dataclasses import replace
from pathlib import Path
from typing import Literal
from abc_tools import parse_abc
from instrumentalize import section_starts

TARGETS=(60,120,180,240,300)
TOLERANCE=.15
MAX_ATTEMPTS=3
RETRY_PREFIX_RESERVE=512

def score_seconds(abc):
 score=parse_abc(abc)
 return float(score.voices['Vocal'].time*60/score.bpm)

def extend_interludes(abc,target,tokenizer):
 """Repeat at most two copies of complete, explicitly labelled instrumental interludes.

 This is a score arrangement operation, not natural-language intent detection. Singing,
 tempo, section order, and every existing note stay intact. Supplied ABC never enters it.
 """
 source=parse_abc(abc);seconds=float(source.voices['Vocal'].time*60/source.bpm)
 if seconds>=target*(1-TOLERANCE):return None
 sections=list(section_starts(abc,source).items());chunks=re.split(r'(?=^% )',abc,flags=re.M)
 if not sections or sections[0][0]!=0 or len(chunks)!=len(sections)+1:return None
 if re.search(r'^[MK]:',''.join(chunks[1:]),re.M) or '[K:' in abc:return None
 eligible=[]
 for index,(start,label) in enumerate(sections):
  if label!='interlude':continue
  end=sections[index+1][0] if index+1<len(sections) else source.voices['Vocal'].time
  if any(t<end and t+d>start for t,p,d in source.voices['Vocal'].notes):continue
  if not any(start<=t<end for t,p,d in source.voices['Ins'].notes):continue
  if any(t<b<t+d for v in source.voices.values() for t,p,d in v.notes for b in (start,end)):continue
  eligible.append((index,start,end))
  if len(eligible)==6:break
 choices=[]
 for counts in itertools.product(range(3),repeat=len(eligible)):
  length=seconds+float(sum((end-start)*count for (_,start,end),count in zip(eligible,counts))*60/source.bpm)
  if target*(1-TOLERANCE)<=length<=target*(1+TOLERANCE):choices.append((abs(length-target),sum(counts),counts,length))
 for _,_,counts,length in sorted(choices):
  repeats={item[0]:count for item,count in zip(eligible,counts) if count}
  candidate=chunks[0]+''.join(chunk+chunk.split('\n',1)[1]*repeats.get(i,0) for i,chunk in enumerate(chunks[1:]))
  ids=tokenizer.encode(candidate)
  if len(ids)>4096:continue
  checked=parse_abc(candidate)
  additions=[(start,end,count) for (_,start,end),count in zip(eligible,counts) if count]
  def shifted(t):return t+sum((end-start)*count for start,end,count in additions if end<=t)
  for name,voice in source.voices.items():
   expected=[(shifted(t),pitch,d) for t,pitch,d in voice.notes]
   for start,end,count in additions:
    prior=sum((b-a)*n for a,b,n in additions if b<=start)
    expected.extend((t+prior+(end-start)*n,pitch,d) for n in range(1,count+1) for t,pitch,d in voice.notes if start<=t<end)
   if sorted(expected)!=[tuple(n) for n in checked.voices[name].notes]:raise ValueError('器乐间奏扩展改变了原旋律，已停止')
   chords=[(shifted(t),chord) for t,chord in voice.chords]
   for start,end,count in additions:
    prior=sum((b-a)*n for a,b,n in additions if b<=start)
    chords.extend((t+prior+(end-start)*n,chord) for n in range(1,count+1) for t,chord in voice.chords if start<=t<end)
   if sorted(chords)!=checked.voices[name].chords:raise ValueError('器乐间奏扩展改变了原和弦，已停止')
  return dict(abc=candidate,abc_ids=ids,beforeSeconds=seconds,afterSeconds=length,repetitions=[dict(section=i,repeats=n) for i,n in repeats.items()])
 return None

def plan_for_duration(pipe,native,sampling,cancelled,on_token,target,out_dir):
 from yue2.protocol import token_prefixes
 if type(target) is not int or target not in TARGETS: raise ValueError('目标时长请选择约 1–5 分钟')
 out_dir=Path(out_dir);out_dir.mkdir(parents=True,exist_ok=True)
 attempts=[];feedback=''
 for attempt in range(1,(1 if native.abc else MAX_ATTEMPTS)+1):
  pipe.check_execution()
  if cancelled and cancelled(): raise InterruptedError('Cancelled during duration planning')
  # The first seed is untouched; bounded subsequent seeds make retries reproducible.
  request=native if attempt==1 else replace(native,style=native.style+feedback,seed=(native.seed+attempt-1)%2147483648)
  if len(token_prefixes(request,pipe.tokenizer))-len(token_prefixes(native,pipe.tokenizer))>RETRY_PREFIX_RESERVE:
   raise ValueError('目标时长重新规划超出预留输入容量，请缩短风格描述')
  pipe.log(f'目标约 {target//60} 分钟 · 正在规划乐谱（{attempt}/{MAX_ATTEMPTS}）')
  plan=pipe.plan(request=request,abc_sampling=sampling,cancelled=cancelled,on_token=on_token)
  plan.save(out_dir/f'duration-attempt-{attempt}')
  seconds=None;problem=None;arrangement=None
  try:
   if plan.truncated: raise ValueError('乐谱写作达到长度上限')
   seconds=score_seconds(plan.abc or '')
   if not native.abc and seconds<target*(1-TOLERANCE):
    extended=extend_interludes(plan.abc,target,pipe.tokenizer)
    if extended:
     plan=replace(plan,abc=extended['abc'],abc_ids=extended['abc_ids'])
     seconds=extended['afterSeconds'];arrangement={k:v for k,v in extended.items() if k not in ('abc','abc_ids')}
     pipe.log(f'已延长完整器乐间奏，保留演唱旋律与歌词；乐谱预计 {seconds:.0f} 秒')
   if not target*(1-TOLERANCE)<=seconds<=target*(1+TOLERANCE): problem='乐谱时长偏离目标'
  except ValueError as exc: problem=str(exc)
  attempts.append(dict(attempt=attempt,seed=request.seed,scoreSeconds=seconds,problem=problem,arrangement=arrangement))
  evidence=dict(targetSeconds=target,tolerance=TOLERANCE,attempts=attempt,scoreSeconds=seconds,accepted=problem is None,plans=attempts)
  (out_dir/'duration.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
  if problem is None:
   pipe.log(f'乐谱预计 {seconds:.0f} 秒，目标 {target} 秒；开始按谱生成音频')
   # Preserve the original request identity, semantic seed and exact generated ABC IDs.
   return replace(plan,request=native,prefix=token_prefixes(native,pipe.tokenizer,plan.abc_ids))
  if native.abc:
   raise ValueError(f'自定义乐谱与目标时长不符或无法检查（{problem}）。请修改乐谱或选择“由模型决定”。')
  feedback=(f'\n\nPlanning correction: the previous score was {seconds:.1f} seconds. ' if seconds is not None else '\n\nPlanning correction: the previous score was incomplete or invalid. ')
  feedback+=f'Write a new complete native two-voice ABC score lasting about {target} seconds. Calculate its total beats from tempo before writing. Allocate sufficient complete bars to every section. Keep the supplied lyrics verbatim and in order; use instrumental passages as needed. Do not compress the song into a short sketch. Do not output prose.'
  pipe.log(f'乐谱未达到目标，重新规划：{problem}')
 raise ValueError(f'未能规划出符合目标时长（约 {target//60} 分钟）的完整乐谱，已停止，未生成音频。请调整风格、歌词或目标时长后重试。')

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
 original_create=Engine.create_song
 def create_song(self,request,out_dir,*,options,on_event=None,cancelled=None):
  fields=dict(request);target=fields.pop('target_duration_seconds',None)
  if target is None:return original_create(self,fields,out_dir,options=options,on_event=on_event,cancelled=cancelled)
  if type(target) is not int or target not in TARGETS:raise ValueError('目标时长请选择约 1–5 分钟')
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
   return self._run_create(pipe,fields,generation,abc_sampling,semantic_sampling,out_dir,options=options,cancelled=cancelled,planner=planner,config_extra={'music_room_duration':{'targetSeconds':target,'tolerance':TOLERANCE,'maxAttempts':MAX_ATTEMPTS,'version':2}})
 Engine.create_song=create_song
 Engine._music_room_duration=True
