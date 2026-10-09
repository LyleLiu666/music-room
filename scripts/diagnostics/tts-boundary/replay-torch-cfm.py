import os,sys,gc,time,json
from pathlib import Path
root=Path(os.environ.get('MUSIC_ROOM_TTS_DIRECTORY', str(Path.home()/'Music/IndexTTS2')));folder=Path(os.environ['MUSIC_ROOM_DIAGNOSTIC_DIR'])
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['PYTORCH_ENABLE_MPS_FALLBACK']='1';os.environ['PYTORCH_MPS_HIGH_WATERMARK_RATIO']='1.0';os.environ['PYTORCH_MPS_LOW_WATERMARK_RATIO']='0.5'
sys.path.insert(0,str(root/'source'))
import numpy as np,torch
from omegaconf import OmegaConf
from indextts.s2mel.modules.commons import MyModel,load_checkpoint2
torch.set_num_threads(4)
total,reference,steps,cfg_rate=map(float,(folder/'cfm-shape.txt').read_text().split());total,reference,steps=int(total),int(reference),int(steps)
cfg=OmegaConf.load(root/'source/checkpoints/config.yaml')
model=MyModel(cfg.s2mel,use_gpt_latent=True)
model,_,_,_=load_checkpoint2(model,None,str(root/'source/checkpoints'/cfg.s2mel_checkpoint))
model=model.to('mps').eval();cfm=model.models['cfm'];cfm.estimator.setup_caches(max_batch_size=2,max_seq_length=total)
def load(name,shape):return torch.from_numpy(np.fromfile(folder/(name+'.f32'),np.float32).reshape(shape)).to('mps')
x=load('cfm-noise',(1,80,total));mu=load('cfm-condition',(1,total,512));prompt=load('cfm-reference',(1,80,reference));style=load('cfm-style',(1,192))
started=time.monotonic()
with torch.inference_mode():out=cfm.solve_euler(x,torch.tensor([total],device='mps'),prompt,mu,style,None,torch.linspace(0,1,steps+1,device='mps'),cfg_rate)
mel=out[0,:,reference:].cpu().numpy();mel.tofile(folder/'torch-cfm-mel.f32')
base=np.fromfile(folder/'mel.f32',np.float32).reshape(80,-1)
report={'seconds':time.monotonic()-started,'frames':mel.shape[1],'mel_mae':float(np.mean(np.abs(mel-base))),'mel_correlation':float(np.corrcoef(mel.flatten(),base.flatten())[0,1]),'last10_max':mel[:,-10:].max(axis=0).tolist()}
(folder/'torch-cfm-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
