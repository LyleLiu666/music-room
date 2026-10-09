/** Explicit opt-in reference blending; legacy inputs never install this override. */
export const referenceEmotionStrengthScript=`def install_reference_emotion_strength(tts,strength,find_most_similar):
 if strength == 1.0:return
 original=tts.gpt.merge_emovec
 def merge(*args,**kwargs):
  reference=original(*args,**kwargs)
  index=find_most_similar(tts.cache_s2mel_style,tts.spk_matrix[-1])
  calm=tts.emo_matrix[-1][index].unsqueeze(0)
  return calm+strength*(reference-calm)
 tts.gpt.merge_emovec=merge
`;
