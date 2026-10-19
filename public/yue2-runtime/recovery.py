"""Durable, verified stage boundaries for Music Room's pinned YuE2 worker.

Only complete stages are committed. A new attempt owns new output files; its
source stays immutable. No partial AR, diffusion-step or VAE-chunk replay.
"""
import hashlib, json, os, re, uuid
from contextlib import contextmanager
from dataclasses import replace, asdict
from pathlib import Path
import numpy as np
from yue2.pipeline import SymbolicPlan, SemanticResult
from yue2.protocol import token_prefixes

STAGES=('plan','semantic','synthesis')
PLAN={'plan/plan.json','plan/plan_manifest.json','plan/abc_tokens.npy','plan/prefix.npy'}
ALLOWED=PLAN|{'plan/score.abc','semantic/result.json','synthesis/latents.npy'}

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def fingerprint(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()).hexdigest()
def request_fields(request):return {k:v for k,v in request.to_dict().items() if k!='id'}
def checked_file(root,name):
 path=root/name
 for p in (root,path.parent,path):
  if p.is_symlink():raise ValueError('恢复点不能包含符号链接')
 if not path.is_file() or path.stat().st_size>4*1024*1024:raise ValueError('恢复点文件缺失或过大')
 return path
def checked_array(path,latent=False):
 with path.open('rb') as f:
  version=np.lib.format.read_magic(f)
  if version not in ((1,0),(2,0)):raise ValueError('恢复点数组格式无效')
  shape,fortran,dtype=(np.lib.format.read_array_header_1_0 if version==(1,0) else np.lib.format.read_array_header_2_0)(f)
  valid=(len(shape)==2 and 0<shape[0]<=9000 and shape[1]==64 and dtype==np.dtype('float32')) if latent else (len(shape)==1 and shape[0]<=24576 and dtype.kind in 'iu' and dtype.itemsize<=8)
  if not valid or fortran or dtype.hasobject:raise ValueError('恢复点数组范围无效')
 return np.load(path,allow_pickle=False)

class Checkpoints:
 def __init__(self,out,source=None):
  self.root=Path(out)/'checkpoints';self.root.mkdir(parents=True,exist_ok=True)
  if self.root.is_symlink():raise ValueError('恢复点不能包含符号链接')
  self.source=Path(source) if source else None;self.saved=None;self.files={};self.key=None
  if self.source:
   if self.source.is_symlink():raise ValueError('恢复点不能包含符号链接')
   root=self.source/'checkpoints'
   if (root/'state.json').exists():
    state=json.loads(checked_file(root,'state.json').read_text())
    if state.get('version')!=1 or state.get('stage') not in STAGES or not isinstance(state.get('files'),dict):raise ValueError('恢复点清单无效')
    names=set(state['files']);required=PLAN|({'semantic/result.json'} if state['stage']!='plan' else set())|({'synthesis/latents.npy'} if state['stage']=='synthesis' else set())
    if not required<=names or names-ALLOWED:raise ValueError('恢复点清单不完整')
    for name,expected in state['files'].items():
     path=checked_file(root,name)
     if digest(path)!=expected:raise ValueError('恢复点校验失败，请从头重新生成')
     if name.endswith('.npy'):checked_array(path,name=='synthesis/latents.npy')
    self.saved=state
   else:
    # Older app versions persisted only the symbolic plan. Never claim later stages exist.
    root=self.source
    manifest=json.loads(checked_file(root,'plan/plan_manifest.json').read_text())
    if set(manifest)-{'plan.json','abc_tokens.npy','prefix.npy','score.abc'}:raise ValueError('旧乐谱清单无效')
    for name in manifest:
     path=checked_file(root,'plan/'+name)
     if name.endswith('.npy'):checked_array(path)
   self.source_root=root
 def commit(self,stage,write):
  temporary=self.root/(stage+'.'+uuid.uuid4().hex+'.partial');temporary.mkdir()
  write(temporary)
  files={stage+'/'+p.name:digest(p) for p in temporary.iterdir() if p.is_file()}
  os.replace(temporary,self.root/stage);self.files.update(files)
  state={'version':1,'stage':stage,'fingerprint':self.key,'files':self.files}
  pending=self.root/'state.json.partial';pending.write_text(json.dumps(state,ensure_ascii=False,allow_nan=False));os.replace(pending,self.root/'state.json')
 def plan(self,pipe,native,abc_sampling,semantic_sampling,extra,generate):
  config={k:v for k,v in pipe.effective_config(native,abc_sampling,semantic_sampling).items() if k!='memory_budget_gib'}
  self.key=fingerprint({'request':request_fields(native),'config':config,'weights':pipe.weights,'extra':extra})
  if self.source:
   if self.saved and self.saved.get('fingerprint')!=self.key:raise ValueError('恢复点与当前要求、模型或生成设置不一致，请从头重新生成')
   plan=SymbolicPlan.load(self.source_root/'plan')
   if request_fields(plan.request)!=request_fields(native) or token_prefixes(native,pipe.tokenizer,plan.abc_ids)!=plan.prefix:raise ValueError('恢复点与当前歌词或乐谱输入不一致')
   plan=replace(plan,request=native);pipe.log('已恢复旋律与和弦，跳过写谱')
  else:plan=generate()
  self.commit('plan',plan.save);return plan
 def semantic(self,pipe,plan,generate):
  if self.saved and self.saved['stage'] in ('semantic','synthesis'):
   value=json.loads((self.source_root/'semantic/result.json').read_text());tokens=value['tokens']
   if not isinstance(tokens,list) or not 0<len(tokens)<=9000 or any(type(n) is not int or n<0 for n in tokens):raise ValueError('恢复点音乐内容无效')
   result=SemanticResult(plan,tokens,value['timing'],value['truncated']);pipe.log('已恢复音乐内容，跳过音乐内容生成')
  else:result=generate()
  self.commit('semantic',lambda p:(p/'result.json').write_text(json.dumps({'tokens':result.tokens,'timing':result.timing,'truncated':result.truncated},allow_nan=False)))
  return result
 def synthesis(self,pipe,semantic,generate):
  if self.saved and self.saved['stage']=='synthesis':
   result=checked_array(self.source_root/'synthesis/latents.npy',True);pipe.log('已恢复完整声音合成结果，直接导出音频')
  else:result=generate()
  if result.dtype!=np.float32 or result.shape!=(len(semantic.tokens),64) or not np.isfinite(result).all():raise ValueError('声音合成恢复点无效')
  self.commit('synthesis',lambda p:np.save(p/'latents.npy',result,allow_pickle=False));return result

@contextmanager
def checkpointed(pipe,out,source,planner,extra,semantic_sampling=None):
 cache=Checkpoints(out,source);original_semantic=pipe.generate_semantic;original_synthesis=pipe.synthesize
 def plan(p,native,sampling,cancelled,observer):
  p.check_execution()
  if cancelled and cancelled():raise InterruptedError('Cancelled before recovery')
  return cache.plan(p,native,sampling,semantic_sampling,extra,lambda:planner(p,native,sampling,cancelled,observer) if planner else p.plan(request=native,abc_sampling=sampling,cancelled=cancelled,on_token=observer))
 def semantic(plan,**kw):
  pipe.check_execution()
  if kw.get('cancelled') and kw['cancelled']():raise InterruptedError('Cancelled before semantic recovery')
  return cache.semantic(pipe,plan,lambda:original_semantic(plan,**kw))
 def synthesis(result,**kw):
  pipe.check_execution()
  if kw.get('cancelled') and kw['cancelled']():raise InterruptedError('Cancelled before synthesis recovery')
  return cache.synthesis(pipe,result,lambda:original_synthesis(result,**kw))
 pipe.generate_semantic=semantic;pipe.synthesize=synthesis
 try:yield plan
 finally:pipe.generate_semantic=original_semantic;pipe.synthesize=original_synthesis

def install():
 from yue2_studio import jobs,worker
 from yue2_studio.engine import Engine
 if getattr(Engine,'_music_room_recovery',False):return
 base=jobs.CreateParams
 class ResumeCreateParams(base):resume_from:str|None=None
 jobs.CreateParams=ResumeCreateParams;jobs._PARAM_MODELS['create']=ResumeCreateParams
 original_params=jobs._create_params_dict
 def params(p,seed):
  result=original_params(p,seed);source=getattr(p,'resume_from',None)
  if source is not None:
   if not re.fullmatch('[a-f0-9]{32}',source):raise ValueError('恢复来源无效')
   result['resume_from']=source
  return result
 jobs._create_params_dict=params
 original_request=jobs.engine_request
 def request(job):
  result=original_request(job)
  if job.params.get('resume_from'):result['resume_from']=job.params['resume_from']
  return result
 jobs.engine_request=worker.engine_request=request
 original_create=Engine.create_song;original_run=Engine._run_create
 def create(self,request,out_dir,**kw):
  fields=dict(request);source=fields.pop('resume_from',None)
  if source is not None and not re.fullmatch('[a-f0-9]{32}',source):raise ValueError('恢复来源无效')
  self._music_room_checkpoint_source=Path(out_dir).parent/source if source else None
  try:return original_create(self,fields,out_dir,**kw)
  finally:del self._music_room_checkpoint_source
 def run(self,pipe,fields,generation,abc_sampling,semantic_sampling,out_dir,**kw):
  if not hasattr(self,'_music_room_checkpoint_source'):return original_run(self,pipe,fields,generation,abc_sampling,semantic_sampling,out_dir,**kw)
  options=asdict(kw['options']);extra={'config':kw.get('config_extra'),'options':{k:options[k] for k in ('preset','precision','ode_steps','fast_numerics','loras','low_memory')}}
  with checkpointed(pipe,out_dir,self._music_room_checkpoint_source,kw.get('planner'),extra,semantic_sampling) as planner:
   return original_run(self,pipe,fields,generation,abc_sampling,semantic_sampling,out_dir,**{**kw,'planner':planner})
 Engine.create_song=create;Engine._run_create=run;Engine._music_room_recovery=True
