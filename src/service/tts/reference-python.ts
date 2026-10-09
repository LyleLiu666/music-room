import {referenceModels} from './reference-models.ts';

/** Runs only in the isolated cleanup environment; source audio never leaves this machine. */
export const cleanReferenceScript=`import os,sys,json,hashlib,tempfile,time,logging,gc
from pathlib import Path
request=json.loads(sys.stdin.readline())
models=${JSON.stringify(referenceModels)}
def stage(message):
 print('MUSIC_ROOM_TTS_EVENT '+json.dumps({'stage':message},ensure_ascii=False),flush=True)
root=Path(os.environ['MUSIC_ROOM_TTS_DIRECTORY'])/'reference-cleanup'
cache=root/'models'
cache.mkdir(parents=True,exist_ok=True)
import requests
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
 return h.hexdigest()
def model_file(model):
 path=cache/model['filename']
 if path.exists() and digest(path)==model['sha256']:return path
 stage('首次下载人声清理模型 · '+model['stage'])
 partial=path.with_suffix(path.suffix+'.partial')
 for attempt in range(3):
  try:
   with requests.get('https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/'+model['filename'],stream=True,timeout=(30,120)) as response:
    response.raise_for_status()
    with open(partial,'wb') as out:
     for chunk in response.iter_content(1048576):out.write(chunk)
   if digest(partial)!=model['sha256']:raise RuntimeError('人声清理模型校验失败')
   os.replace(partial,path)
   return path
  except Exception:
   partial.unlink(missing_ok=True)
   if attempt==2:raise
   time.sleep(2*(attempt+1))
for model in models:model_file(model)
import numpy as np,soundfile as sf,torch,librosa,imageio_ffmpeg
torch.set_num_threads(min(4,os.cpu_count() or 4))
# Use the bundled FFmpeg executable; do not require a system installation.
ffmpeg=Path(imageio_ffmpeg.get_ffmpeg_exe())
bin_dir=root/'bin'
bin_dir.mkdir(exist_ok=True)
link=bin_dir/'ffmpeg'
if not link.exists():link.symlink_to(ffmpeg)
os.environ['PATH']=str(bin_dir)+os.pathsep+os.environ['PATH']
from audio_separator.separator import Separator
class ReferenceSeparator(Separator):
 # Pin metadata together with each weight, avoiding mutable upstream model lists.
 def download_model_files(self,filename):
  model=next(m for m in models if m['filename']==filename)
  return filename,model['type'],filename,str(cache/filename),None
 def load_model_data_using_hash(self,path):
  return dict(next(m for m in models if m['filename']==Path(path).name)['data'])
with tempfile.TemporaryDirectory(prefix='reference-',dir=root) as work:
 current=request['referencePath']
 for index,model in enumerate(models):
  stage(model['stage'])
  separator=ReferenceSeparator(log_level=logging.WARNING,model_file_dir=str(cache),output_dir=work,output_format='WAV',output_single_stem=model['stem'],sample_rate=44100,use_soundfile=False,normalization_threshold=0.9,mdx_params={'hop_length':1024,'segment_size':256,'overlap':0.25,'batch_size':1,'enable_denoise':True})
  separator.load_model(model['filename'])
  wanted=Path(work)/('stage-'+str(index)+'.wav')
  separator.separate(current,{model['stem']:str(wanted.with_suffix(''))})
  if not wanted.exists():raise RuntimeError('清理模型未产出指定的人声轨道：'+model['stem'])
  check,_=sf.read(wanted)
  if not np.isfinite(check).all() or np.max(np.abs(check))<.001:raise RuntimeError(model['stage']+'后没有可用人声，请换一个片段')
  current=str(wanted)
  del separator
  gc.collect()
  if torch.backends.mps.is_available():torch.mps.empty_cache()
 stage('整理人声片段并保存音色')
 audio,sr=sf.read(current,always_2d=True)
 audio=audio.mean(axis=1)
 if not np.isfinite(audio).all():raise RuntimeError('清理结果包含无效音频数据')
 audio=librosa.resample(audio,orig_sr=sr,target_sr=22050)
 audio,_=librosa.effects.trim(audio,top_db=35)
 audio=audio[:15*22050]
 peak=float(np.max(np.abs(audio))) if len(audio) else 0
 if len(audio)<.3*22050 or peak<.001:raise RuntimeError('清理后没有可用的人声，请换一个片段')
 audio=audio*(0.85/peak)
 sf.write(request['outputPath'],audio,22050,subtype='PCM_16',format='WAV')
stage('人声清理完成')
`;
