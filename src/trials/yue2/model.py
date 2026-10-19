"""One isolated invocation against pinned local MLX weights. Never opens Studio DB."""
import json, os, sys
from pathlib import Path

def execute(engine, options, task, out):
 request=task['request']['params']
 def event(value):
  # Streaming ABC text is quadratic in score length; final score is a separate artifact.
  if value.get('type')=='abc': value={k:v for k,v in value.items() if k!='text'}
  print(json.dumps(value,ensure_ascii=False),flush=True)
 if task['kind']=='render':
  if not request.get('abc'): raise ValueError('Fixed score required')
  return engine.create_song(request,out,options=options,on_event=event)
 from yue2.protocol import GenerationConfig, SongRequest
 fields,generation,abc_sampling,_=engine._split_request(request)
 SongRequest(**fields)
 pipe=engine.ensure(options,event)
 with engine._busy(pipe):
  pipe.set_loras(engine.resolve_loras(options.loras))
  pipe.generation_config=GenerationConfig.from_dict({**generation,'ode_steps':options.ode_steps})
  pipe.fast_numerics=options.fast_numerics
  native=pipe.build_request(**fields)
  plan=pipe.plan(request=native,abc_sampling=abc_sampling,on_token=pipe.token_observer(abc_prefix=''))
  plan.save(out/'plan')
  if plan.truncated: raise ValueError('写谱达到长度上限，原始乐谱已保留；请调整描述或种子重试')
  (out/'effective.json').write_text(json.dumps(dict(request=native.to_dict(),config=pipe.effective_config(native,abc_sampling,None),weights=pipe.weights),default=str))
 # Intentionally return here: no semantic generation, synthesis, or decoding.

if __name__=='__main__':
 root,out=Path(sys.argv[1]),Path(sys.argv[2]);task=json.loads((out/'request.json').read_text())
 os.environ.update(YUE2_STUDIO_HOME=str(out/'runtime'),HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HOME=str(out/'cache'),XDG_CACHE_HOME=str(out/'cache'),MLX_ENABLE_TF32='0',PYTHONDONTWRITEBYTECODE='1')
 from yue2_studio.config import resolve_preset
 from yue2_studio.engine import Engine
 options=resolve_preset(task['request']['preset'],loras=task['request']['loras'],low_memory=True,memory_budget_gib=float(sys.argv[3]),fast_numerics=False)
 engine=Engine(converted_dir=root/'models/converted',vae_dir=root/'models/vae',loras_dir=root/'models/loras')
 try: execute(engine,options,task,out)
 finally: engine.unload()
