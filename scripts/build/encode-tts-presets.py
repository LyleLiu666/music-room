from pathlib import Path
import argparse,json,hashlib,os
parser=argparse.ArgumentParser(description='Encode bundled dry voices with the pinned IndexTTS 2.0 CPU analysis path')
parser.add_argument('--runtime',type=Path,required=True)
parser.add_argument('--project',type=Path,required=True)
args=parser.parse_args()
metadata=json.loads((args.runtime/'installed.json').read_text())
if metadata.get('sourceRevision')!='830f6f8f94a51fea23ab1d639027a86200075a4e' or metadata.get('modelRevision')!='740dcaff396282ffb241903d150ac011cd4b1ede':
 raise ValueError('Require the fixed IndexTTS 2.0 runtime and weights')
os.chdir(args.runtime.resolve()/'source')
import numpy as np
import torch,torchaudio
from indextts import infer_v2 as upstream
class Unused(torch.nn.Module):
 def post_init_gpt2_config(self,**kwargs):pass
 def remove_weight_norm(self):pass
upstream.UnifiedVoice=lambda **kwargs:Unused()
upstream.load_checkpoint=lambda *args:None
upstream.QwenEmotion=lambda *args:None
upstream.bigvgan.BigVGAN.from_pretrained=lambda *args,**kwargs:Unused()
root=args.project.resolve(); model=args.runtime.resolve()/'source/checkpoints'
torch.set_num_threads(8)
with torch.no_grad():
 tts=upstream.IndexTTS2(cfg_path=str(model/'config.yaml'),model_dir=str(model),device='cpu',use_fp16=False)
 for name in ['official','tianjin','influencer','dilireba','shenteng']:
  path=root/'public/tts-presets'/(name+'.wav')
  audio,sr=tts._load_and_cut_audio(str(path),15)
  audio22=torchaudio.transforms.Resample(sr,22050)(audio)
  audio16=torchaudio.transforms.Resample(sr,16000)(audio)
  inputs=tts.extract_features(audio16,sampling_rate=16000,return_tensors='pt')
  embedding=tts.get_emb(inputs['input_features'],inputs['attention_mask'])
  _,semantic=tts.semantic_codec.quantize(embedding)
  mel=tts.mel_fn(audio22.float())
  feature=torchaudio.compliance.kaldi.fbank(audio16,num_mel_bins=80,dither=0,sample_frequency=16000)
  feature=feature-feature.mean(dim=0,keepdim=True)
  style=tts.campplus_model(feature.unsqueeze(0))
  prompt=tts.s2mel.models['length_regulator'](semantic,ylens=torch.LongTensor([mel.size(2)]),n_quantizers=3,f0=None)[0]
  emo_audio,_=tts._load_and_cut_audio(str(path),15,sr=16000)
  emo_input=tts.extract_features(emo_audio,sampling_rate=16000,return_tensors='pt')
  emo=tts.get_emb(emo_input['input_features'],emo_input['attention_mask'])
  arrays={'version':np.array([2.0]),'spk_cond_emb':embedding.numpy(),'S_ref':semantic.numpy(),'ref_mel':mel.numpy(),'style':style.numpy(),'prompt_condition':prompt.numpy(),'emo_cond_emb':emo.numpy()}
  np.savez(root/'public/tts-presets'/(name+'.npz'),**arrays)
  print(name,hashlib.sha256((root/'public/tts-presets'/(name+'.npz')).read_bytes()).hexdigest(),flush=True)
