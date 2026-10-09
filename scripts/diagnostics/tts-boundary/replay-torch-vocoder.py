import os,sys,time,json
from pathlib import Path
root=Path(os.environ.get('MUSIC_ROOM_TTS_DIRECTORY', str(Path.home()/'Music/IndexTTS2')))
os.environ['HF_HOME']=str(root/'cache/huggingface');os.environ['HF_HUB_CACHE']=str(root/'source/checkpoints/hf_cache');os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['PYTORCH_ENABLE_MPS_FALLBACK']='1';os.environ['PYTORCH_MPS_HIGH_WATERMARK_RATIO']='1.0';os.environ['PYTORCH_MPS_LOW_WATERMARK_RATIO']='0.5'
sys.path.insert(0,str(root/'source'))
import numpy as np,torch,soundfile as sf
from indextts.s2mel.modules.bigvgan import bigvgan
torch.set_num_threads(4)
folder=Path(os.environ['MUSIC_ROOM_DIAGNOSTIC_DIR'])
channels,frames,seed=map(int,(folder/'shape.txt').read_text().split());mel=np.fromfile(folder/'mel.f32',dtype=np.float32).reshape(channels,frames)
model=bigvgan.BigVGAN.from_pretrained('nvidia/bigvgan_v2_22khz_80band_256x',use_cuda_kernel=False).to('mps');model.remove_weight_norm();model.eval()
for pad in [0,20]:
 source=np.pad(mel,((0,0),(0,pad)),constant_values=np.log(1e-5))
 started=time.monotonic()
 with torch.inference_mode():wave=model(torch.from_numpy(source).unsqueeze(0).to('mps')).squeeze().cpu().numpy()
 wave.tofile(folder/f'torch-pad{pad}.f32');sf.write(folder/f'torch-pad{pad}.wav',np.clip(wave,-1,1),22050,subtype='PCM_16')
 print(json.dumps({'pad':pad,'samples':len(wave),'seconds':time.monotonic()-started,'peak':float(np.max(np.abs(wave))),'tail_rms':float(np.sqrt(np.mean(wave[-441:]**2)))}),flush=True)
 del source,wave;torch.mps.empty_cache()
