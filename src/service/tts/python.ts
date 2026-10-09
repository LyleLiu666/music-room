import {conditioningScript} from './conditioning-python.ts';
export const modelRevision='740dcaff396282ffb241903d150ac011cd4b1ede';
export const companions={
 'facebook/w2v-bert-2.0':'da985ba0987f70aaeb84a80f2851cfac8c697a7b',
 'amphion/MaskGCT':'265c6cef07625665d0c28d2faafb1415562379dc',
 'funasr/campplus':'e4b6ede7ce16997aff4ae69fbca1f0175e2afede',
 'nvidia/bigvgan_v2_22khz_80band_256x':'633ff708ed5b74903e86ff1298cf4a98e921c513',
};
export const modelSetup=`import os,json,time,requests
from pathlib import Path
from huggingface_hub import snapshot_download
root=Path(os.environ['MUSIC_ROOM_TTS_DIRECTORY'])
cache=root/'source'/'checkpoints'/'hf_cache'
target=root/'source'/'checkpoints'
def stage(message):
 print('MUSIC_ROOM_TTS_EVENT '+json.dumps({'stage':message},ensure_ascii=False),flush=True)
def fetch_model(repo,**kwargs):
 for attempt in range(4):
  try:
   return snapshot_download(repo,**kwargs)
  except (requests.exceptions.ConnectionError,requests.exceptions.ChunkedEncodingError,requests.exceptions.Timeout):
   if attempt==3: raise
   print('网络连接中断，继续已下载的 '+repo+'（重试 '+str(attempt+1)+'/3）',flush=True)
   time.sleep(2*(attempt+1))
stage('下载 IndexTTS 2.0 主模型')
fetch_model('IndexTeam/IndexTTS-2',revision='${modelRevision}',local_dir=str(target),ignore_patterns=['*.md','Modelfile'])
models=[('facebook/w2v-bert-2.0','${companions['facebook/w2v-bert-2.0']}', ['config.json','preprocessor_config.json','model.safetensors']),('amphion/MaskGCT','${companions['amphion/MaskGCT']}', ['semantic_codec/model.safetensors']),('funasr/campplus','${companions['funasr/campplus']}', ['campplus_cn_common.bin']),('nvidia/bigvgan_v2_22khz_80band_256x','${companions['nvidia/bigvgan_v2_22khz_80band_256x']}', ['config.json','bigvgan_generator.pt'])]
for repo,rev,files in models:
 stage({'facebook/w2v-bert-2.0':'下载参考音频分析模型','amphion/MaskGCT':'下载语音编码模型','funasr/campplus':'下载音色分析模型','nvidia/bigvgan_v2_22khz_80band_256x':'下载音频合成模型'}[repo])
 print('下载语音组件 '+repo,flush=True)
 fetch_model(repo,revision=rev,cache_dir=str(cache),allow_patterns=files)
 ref=cache/('models--'+repo.replace('/','--'))/'refs'/'main'
 ref.parent.mkdir(parents=True,exist_ok=True)
 ref.write_text(rev)
import socket
socket.setdefaulttimeout(60)
import nltk
stage('准备朗读文字处理组件')
for item in ['averaged_perceptron_tagger_eng','averaged_perceptron_tagger','cmudict','punkt_tab']:
 nltk.download(item,download_dir=os.environ['NLTK_DATA'],raise_on_error=True)
# Catch binary/import incompatibilities before reporting the environment ready.
stage('检查语音运行环境')
from indextts.infer_v2 import IndexTTS2
print('IndexTTS 2.0 依赖检查通过，语音模型下载完成',flush=True)
`;
export const inferScript=`import sys,json,os,time,traceback
from pathlib import Path
request=json.loads(sys.stdin.readline())
${conditioningScript}
def stage(message):
 print('MUSIC_ROOM_TTS_EVENT '+json.dumps({'stage':message},ensure_ascii=False),flush=True)
try:
 stage('加载 IndexTTS 2.0 模型')
 import torch
 torch.set_num_threads(min(8,os.cpu_count() or 4))
 from indextts.infer_v2 import IndexTTS2
 from indextts import infer_v2 as upstream
 root=Path(os.environ['MUSIC_ROOM_TTS_DIRECTORY'])
 model=root/'source'/'checkpoints'
 if request.get('conditioningPath'):os.environ['PYTORCH_MPS_LOW_WATERMARK_RATIO']='0.22'
 features=load_conditioning(torch,request)
 emotion=request.get('emotion') or ''
 emotion_values=prepare_emotion(upstream,model,emotion,torch)
 class CachedEmotion:
  def inference(self,text):return emotion_values
 upstream.QwenEmotion=lambda *args:CachedEmotion()
 optimized_mps=features is not None and torch.backends.mps.is_available()
 if optimized_mps:
  torch.mps.set_per_process_memory_fraction(min(1.0,7*2**30/torch.mps.recommended_max_memory()))
 if features is not None:
  upstream.build_semantic_model=lambda *args:(torch.nn.Module(),torch.zeros(1),torch.ones(1))
 options={'device':'mps','use_fp16':True} if optimized_mps else {'use_fp16':torch.cuda.is_available()}
 tts=IndexTTS2(cfg_path=str(model/'config.yaml'),model_dir=str(model),use_cuda_kernel=False,use_deepspeed=False,**options)
 if features is not None:install_conditioning(tts,features,request['referencePath'],torch)
 def progress(value,desc=''):
  if value < .1: stage('准备内置音色' if features is not None else '分析参考声音')
  elif value < .2: stage('处理朗读文字')
  elif value < 1: stage('正在合成语音 · '+desc)
  else: stage('保存语音文件')
 tts.gr_progress=progress
 stage('正在合成语音')
 emotion=request.get('emotion') or ''
 # Keep short utterances continuous: a 40-token cap split ordinary greetings
 # into independent generations with an abrupt fixed-silence join. Long texts
 # retain the measured 40-token memory budget. Count with upstream's real BPE.
 segment_tokens=120
 if features is not None:
  segment_tokens=60 if len(tts.tokenizer.tokenize(request['text']))<=60 else 40
 # Upstream's inner no_grad scope does not cover reference conditioning.
 # Its cached style/prompt tensors otherwise keep training activations alive.
 with torch.no_grad():
  tts.infer(spk_audio_prompt=request['referencePath'],text=request['text'],output_path=request['outputPath'],use_emo_text=bool(emotion),emo_text=emotion or None,emo_alpha=0.6 if emotion else 1.0,use_random=False,verbose=False,num_beams=1,max_text_tokens_per_segment=segment_tokens)
 # Publish a portable 16-bit PCM WAV even if upstream selects another subtype.
 import soundfile as sf
 audio,sr=sf.read(request['outputPath'])
 sf.write(request['outputPath'],audio,sr,subtype='PCM_16',format='WAV')
 stage('保存语音文件')
except Exception:
 traceback.print_exc()
 sys.exit(1)
`;
export const referenceSetup=`import os
from pathlib import Path
import soundfile as sf
root=Path(os.environ['MUSIC_ROOM_TTS_DIRECTORY'])/'source'/'examples'
audio,sr=sf.read(root/'voice_01.wav')
sf.write(root/'voice_01-pcm.partial.wav',audio,sr,subtype='PCM_16',format='WAV')
os.replace(root/'voice_01-pcm.partial.wav',root/'voice_01-pcm.wav')
print('官方示例声音已转换为 PCM WAV',flush=True)
`;
