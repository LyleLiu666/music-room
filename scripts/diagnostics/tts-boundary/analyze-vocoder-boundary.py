import os
from pathlib import Path
import numpy as np,soundfile as sf,json
p=Path(os.environ['MUSIC_ROOM_DIAGNOSTIC_DIR'])
channels,frames,seed=map(int,(p/'shape.txt').read_text().split());mel=np.fromfile(p/'mel.f32',np.float32).reshape(channels,frames)
print('mel_last_frames',json.dumps({'min':mel[:,-10:].min(axis=0).tolist(),'max':mel[:,-10:].max(axis=0).tolist(),'linear_energy':np.exp(mel[:,-10:]).mean(axis=0).tolist()}))
records=[]
for name in ['wave','torch-pad0','torch-pad20','cpp-pad0','cpp-pad20']:
 file=p/(name+'.f32')
 if not file.exists():continue
 x=np.fromfile(file,np.float32);sf.write(p/(name+'.wav'),np.clip(x,-1,1),22050,subtype='PCM_16')
 end=frames*256;row={'name':name,'duration':len(x)/22050,'tail_rms':float(np.sqrt(np.mean(x[-441:]**2))),'at_original_end_rms':float(np.sqrt(np.mean(x[end-441:end]**2))),'final_sample':float(x[-1])};records.append(row)
base=np.fromfile(p/'wave.f32',np.float32)
for name in ['torch-pad0','cpp-pad0','cpp-pad20']:
 file=p/(name+'.f32')
 if not file.exists():continue
 x=np.fromfile(file,np.float32)[:len(base)];prefix=22050*4
 print('comparison',json.dumps({'name':name,'max_abs_difference':float(np.max(np.abs(base-x))),'prefix_max_abs_difference':float(np.max(np.abs(base[:prefix]-x[:prefix]))),'prefix_correlation':float(np.corrcoef(base[:prefix],x[:prefix])[0,1]),'tail_rms_ratio':float(np.sqrt(np.mean(x[-441:]**2))/np.sqrt(np.mean(base[-441:]**2)))}))
print(json.dumps(records,indent=2));(p/'boundary-analysis.json').write_text(json.dumps({'samples':records,'mel_last_max':mel[:,-10:].max(axis=0).tolist()},indent=2))
