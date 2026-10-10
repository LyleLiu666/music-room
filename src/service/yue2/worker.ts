import {ResourceLease} from '../resources/lease.ts';
import {signalWorkload} from '../resources/processes.ts';
import {spawn} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync,unlinkSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createInterface} from 'node:readline';
import {z} from 'zod';

const taskSchema=z.object({directory:z.string().refine(isAbsolute),owner:z.string().min(1),step:z.enum(['venv','dependencies','studio','check','models','instrumental','serve']),port:z.number().int().min(1).max(65535).optional(),nonce:z.string().regex(/^[a-f0-9]{64}$/).optional(),credential:z.string().regex(/^[a-f0-9]{64}$/).optional(),budget:z.number().positive().optional(),resourceLease:z.object({directory:z.string(),owner:z.string()}).optional()}).strict();
export type YuE2Task=z.infer<typeof taskSchema>;
export function runtimeEnvironment(root:string,parent:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={};
  for(const key of ['HOME','USER','LOGNAME','LANG','LC_ALL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR'])if(parent[key])env[key]=parent[key];
  Object.assign(env,{PATH:`${join(root,'.venv','bin')}:${join(root,'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,YUE2_STUDIO_HOME:root,UV_NO_CONFIG:'1',UV_PYTHON_INSTALL_DIR:join(root,'python'),UV_PYTHON_BIN_DIR:join(root,'bin'),UV_CACHE_DIR:join(root,'cache','uv'),HF_HOME:join(root,'cache','huggingface'),HF_HUB_CACHE:join(root,'cache','huggingface','hub'),HF_XET_CACHE:join(root,'cache','huggingface','xet'),HF_ASSETS_CACHE:join(root,'cache','huggingface','assets'),XDG_CACHE_HOME:join(root,'cache'),XDG_DATA_HOME:join(root,'data'),XDG_CONFIG_HOME:join(root,'config'),XDG_STATE_HOME:join(root,'state'),PIP_CACHE_DIR:join(root,'cache','pip'),TORCH_HOME:join(root,'cache','torch'),NUMBA_CACHE_DIR:join(root,'cache','numba'),MPLCONFIGDIR:join(root,'cache','matplotlib'),PYTHONPYCACHEPREFIX:join(root,'cache','pycache'),TMPDIR:join(root,'tmp'),PYTHONUNBUFFERED:'1',MLX_ENABLE_TF32:'0',HF_HUB_DISABLE_PROGRESS_BARS:'0',HF_HUB_DISABLE_XET:'1',HF_XET_CHUNK_CACHE_SIZE_BYTES:'0'});
  return env;
}
const instrumental=`from huggingface_hub import hf_hub_download
from pathlib import Path
import os
target=Path(os.environ['YUE2_STUDIO_HOME'])/'models'/'loras'
target.mkdir(parents=True,exist_ok=True)
for repo,rev,name in [('Mothersuperior/YuE2-instrumental-cot-full-loras','947f2f4b28978b2b6c3e316e6a87925c76bf3c4b','ar_lora_inst_v3abc.bf16.safetensors'),('Mothersuperior/yue2-mothersuperior-realaudio-tokenizer-v4','e2e63d859f3af879baf1b4d4e9f22d1eeda6fde5','nar_lora_joint_v4.bf16.safetensors')]:
 print('Downloading instrumental adapter: '+name,flush=True)
 hf_hub_download(repo,name,revision=rev,local_dir=str(target))`;
const modelSetup=`from huggingface_hub import snapshot_download
from lyra.conversion import _VAE_SOURCE_FILES, VAE_REVISION
from yue2_studio import config
from pathlib import Path
import os,runpy,shutil,sys
generator_files=['conversion.json','LICENSE','THIRD_PARTY_NOTICES.md','config.json','qwen.tiktoken','ar-8bit.safetensors','ar-bf16.safetensors','nar-bf16.safetensors','licenses/SnakeBeta-NVIDIA-MIT.txt','licenses/stable-audio-tools-MIT.txt']
for repo,revision,target,files in [(config.MODEL_REPO,'5f7620e546fb3c6130a09a7e18172e3bb7aaeddb',config.CONVERTED_DIR,generator_files),(config.VAE_REPO,VAE_REVISION,config.VAE_DIR,sorted(_VAE_SOURCE_FILES))]:
 print('Downloading pinned model '+repo+' -> '+str(target),flush=True)
 snapshot_download(repo,revision=revision,local_dir=str(target),allow_patterns=files)
 shutil.rmtree(target/'.cache',ignore_errors=True)
 (target/'.gitattributes').unlink(missing_ok=True)
script=Path(os.environ['YUE2_STUDIO_HOME'])/'source'/'scripts'/'setup.py'
sys.argv=[str(script),'--skip-download']
runpy.run_path(str(script),run_name='__main__')`;
const serve=`import os
from yue2_studio.main import create_app
from yue2_studio import config
from pathlib import Path
import json
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import uvicorn
app=create_app(home=os.environ['YUE2_STUDIO_HOME'],fake=False)
# Never let startup recover unfinished jobs outside the workbench queue.
for old_id in app.state.store.queued_ids():
 app.state.store.update_status(old_id,'failed',error='Music Room: interrupted; retry explicitly')
profile=Path(os.environ['YUE2_STUDIO_HOME'])/'config'/'music-room-profile.json'
if not profile.exists():
 defaults={'low_memory':'on','memory_budget_gib':min(12.0,config.max_memory_budget_gib())}
 app.state.store.update_settings(defaults)
 profile.parent.mkdir(parents=True,exist_ok=True)
 temporary=profile.with_suffix('.tmp')
 temporary.write_text(json.dumps({'version':1,'defaults':defaults}))
 temporary.replace(profile)
if os.environ.get('MUSIC_ROOM_RESOURCE_BUDGET'):
 app.state.store.update_settings({'low_memory':'on','memory_budget_gib':float(os.environ['MUSIC_ROOM_RESOURCE_BUDGET'])/(1024**3)})
origin='http://127.0.0.1:'+os.environ['MUSIC_ROOM_YUE2_PORT']
class LocalOnly(BaseHTTPMiddleware):
 async def dispatch(self,request,call_next):
  if request.headers.get('host')!='127.0.0.1:'+os.environ['MUSIC_ROOM_YUE2_PORT'] or request.headers.get('origin') not in (None,origin):
   return JSONResponse({'error':'Local requests only'},status_code=403)
  if request.method not in ('GET','HEAD') and os.environ.get('MUSIC_ROOM_EXECUTION') and request.headers.get('x-music-room-execution')!=os.environ['MUSIC_ROOM_EXECUTION']:
   return JSONResponse({'error':'Execution right required'},status_code=403)
  response=await call_next(request)
  response.headers['X-Music-Room-Engine']=os.environ['MUSIC_ROOM_YUE2_NONCE']
  return response
app.add_middleware(LocalOnly)
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['MUSIC_ROOM_YUE2_PORT']),log_level='info')`;

export function workerCommand(input:YuE2Task) {
  const task=taskSchema.parse(input),root=task.directory,lock=join(root,'.music-room-yue2.lock');
  if(!existsSync(lock)||JSON.parse(readFileSync(lock,'utf8')).owner!==task.owner)throw new Error('YuE2 目录不属于所属工作台');
  const uv=join(root,'bin','uv'),python=join(root,'.venv','bin','python');
  switch(task.step){
    case 'venv':return {command:uv,args:['venv','--managed-python','--python','3.12','--allow-existing',join(root,'.venv')]};
    case 'dependencies':return {command:uv,args:['pip','sync','--python',python,'--require-hashes','--no-sources',join(root,'requirements.txt')]};
    case 'studio':return {command:uv,args:['pip','install','--python',python,'--no-deps','--no-sources',join(root,'source')]};
    case 'check':return {command:python,args:['-c','import yue2_studio, lyra, mlx.core; print("YuE2 Python environment ready",flush=True)']};
    case 'models':return {command:python,args:['-c',modelSetup]};
    case 'instrumental':return {command:python,args:['-c',instrumental]};
    case 'serve':if(!task.port||!task.nonce)throw new Error('启动参数无效');return {command:python,args:['-c',serve]};
  }
}

/** stdin remains open as a parent lease; EOF stops the owned process group. */
export async function runYuE2Worker() {
  const lines=createInterface({input:process.stdin});let started=false;
  await new Promise<void>((resolve,reject)=>{
    lines.once('line',line=>{
      try{
        if(line.length>16384)throw new Error('YuE2 任务参数过大');
        const task=taskSchema.parse(JSON.parse(line)),spec=workerCommand(task);started=true;
        const env=runtimeEnvironment(task.directory);if(task.port)env.MUSIC_ROOM_YUE2_PORT=String(task.port);if(task.nonce)env.MUSIC_ROOM_YUE2_NONCE=task.nonce;if(task.credential)env.MUSIC_ROOM_EXECUTION=task.credential;if(task.budget)env.MUSIC_ROOM_RESOURCE_BUDGET=String(task.budget);
        mkdirSync(env.TMPDIR!,{recursive:true});
        const child=spawn(spec.command,spec.args,{cwd:task.directory,env,detached:!task.resourceLease,stdio:['ignore','inherit','inherit']});
        if(child.pid&&task.resourceLease)ResourceLease.trackWorker(task.resourceLease,child.pid);
        const lockPath=join(task.directory,'.music-room-yue2.lock');
        let ending=false,timer:ReturnType<typeof setTimeout>|undefined;
        const stop=()=>{if(ending)return;ending=true;if(child.pid)signalWorkload(child.pid,!!task.resourceLease,'SIGTERM');timer=setTimeout(()=>{if(child.pid)signalWorkload(child.pid,!!task.resourceLease,'SIGKILL');},5000);timer.unref();};
        lines.once('close',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
        child.once('error',reject);
        child.once('close',code=>{
          if(child.pid)signalWorkload(child.pid,!!task.resourceLease,'SIGKILL');if(timer)clearTimeout(timer);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);lines.removeListener('close',stop);lines.close();process.stdin.destroy();
          // Only a lost parent lease releases the root; successful installation stages retain it.
          if(ending&&existsSync(lockPath)){const current=JSON.parse(readFileSync(lockPath,'utf8'));if(current.owner===task.owner){try{process.kill(current.pid,0);}catch{unlinkSync(lockPath);}}}
          process.exitCode=code??1;resolve();
        });
      }catch(error){lines.close();process.stdin.destroy();reject(error);}
    });
    lines.once('close',()=>{if(!started)reject(new Error('缺少 YuE2 任务'));});
  });
}
