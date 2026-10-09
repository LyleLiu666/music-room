/** Adapter for the pinned IndexTTS 2.0 cache fields; it does not change weights. */
export const conditioningScript=`def load_conditioning(torch,request):
 path=request.get('conditioningPath')
 if not path:return None
 import hashlib,numpy as np
 if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=request.get('conditioningSha256'):
  raise ValueError('内置音色特征校验失败')
 with np.load(path,allow_pickle=False) as archive:
  if archive['version'].tolist()!=[2.0]:raise ValueError('内置音色特征模型版本错误')
  shapes={'spk_cond_emb':1024,'emo_cond_emb':1024,'ref_mel':80,'style':192,'prompt_condition':512}
  result={}
  for name,width in shapes.items():
   value=archive[name]
   valid=value.ndim==(2 if name=='style' else 3) and value.shape[0]==1 and all(size>0 for size in value.shape)
   valid=valid and value.shape[1 if name=='ref_mel' else -1]==width
   if not valid or value.dtype!=np.float32 or not np.isfinite(value).all():
    raise ValueError('内置音色特征格式错误：'+name)
   result[name]=torch.from_numpy(value.copy())
  if result['ref_mel'].shape[2]!=result['prompt_condition'].shape[1]:
   raise ValueError('内置音色特征长度不一致')
 return result

def prepare_emotion(upstream,model,emotion,torch):
 # The model reads the complete description. No input word list overrides it.
 if not emotion:return None
 import gc,math
 classifier=upstream.QwenEmotion(str(model/'qwen0.6bemo4-merge'))
 classifier.model.to('cpu')
 messages=[{'role':'system','content':'文本情感分类'},{'role':'user','content':emotion}]
 prompt=classifier.tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
 inputs=classifier.tokenizer([prompt],return_tensors='pt').to(classifier.model.device)
 with torch.no_grad():
  ids=classifier.model.generate(**inputs,max_new_tokens=256,pad_token_id=classifier.tokenizer.eos_token_id,do_sample=False)
 content=classifier.tokenizer.decode(ids[0][inputs.input_ids.shape[1]:],skip_special_tokens=True).strip()
 values,end=json.JSONDecoder().raw_decode(content)
 if not isinstance(values,dict) or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in values.values()):
  raise ValueError('情绪模型没有返回有效的强度 JSON')
 result=classifier.convert(values)
 del classifier,inputs,ids
 gc.collect()
 if torch.backends.mps.is_available():
  torch.mps.synchronize()
  torch.mps.empty_cache()
 return result

def install_conditioning(tts,features,reference,torch):
 for field,name in [('cache_spk_cond','spk_cond_emb'),('cache_emo_cond','emo_cond_emb'),('cache_s2mel_style','style'),('cache_s2mel_prompt','prompt_condition'),('cache_mel','ref_mel')]:
  setattr(tts,field,features[name].to(tts.device))
 tts.cache_spk_audio_prompt=reference
 tts.cache_emo_audio_prompt=reference
 if tts.device=='mps':
  # Speaker/style embeddings keep the full reference. The waveform network
  # needs only a short aligned mel/content prefix, avoiding a 15-second prompt
  # in every diffusion step. Keep the original archive/audio for provenance.
  frames=int(6*22050/256)
  tts.cache_mel=tts.cache_mel[:,:,:frames]
  tts.cache_s2mel_prompt=tts.cache_s2mel_prompt[:,:frames,:]
  steps=0
  def decode_input(module,args):
   nonlocal steps
   steps+=1
   if steps%32==0:
    torch.mps.synchronize()
    torch.mps.empty_cache()
  tts.gpt.inference_model.register_forward_pre_hook(decode_input)
  # Reclaim temporary allocations at stage boundaries, after the prior GPU work.
  def projection_input(module,args):
   torch.mps.synchronize()
   torch.mps.empty_cache()
   return (args[0].float(),)
  def vocoder_input(module,args):
   torch.mps.synchronize()
   torch.mps.empty_cache()
  tts.s2mel.models['gpt_layer'].register_forward_pre_hook(projection_input)
  tts.bigvgan.register_forward_pre_hook(vocoder_input)
`;
