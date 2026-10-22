"""Local transcription and alignment; the TS service reviews words between phases."""
import os,sys,json,threading,time,gc,re,pathlib
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'

def phrases(text):
    # Punctuation is only a display boundary, never a semantic matching decision.
    return [part.strip() for part in re.split(r'[，。！？；,.!?;\n]+',text) if part.strip()]

def reference_candidates(transcript,reference):
    # Lexical recall ONLY provides optional ASR context. It never replaces output,
    # assigns a lyric occurrence, or chooses a processing action. The audio model
    # decides what was sung, including novel and repeated sections.
    def grams(text):
        chars=''.join(c for c in text if c.isalnum())
        return [chars[i:i+2] for i in range(len(chars)-1)]
    candidates=[line.strip() for line in reference.splitlines() if line.strip() and not line.strip().startswith('[')]
    query=grams(transcript)
    if not query:return ''
    candidate_grams=[grams(line) for line in candidates];best_score=0.;best=None
    # Rank contiguous passages by ordered recall. A bag of shared grams loses
    # the order of repeated chorus anchors and can retrieve the wrong side of
    # a repeated line, excluding the misheard sentence between those anchors.
    # LCS only ranks context candidates; it never substitutes performed lyrics.
    for start in range(len(candidates)):
        lengths=[0]*(len(query)+1);size=0
        for end in range(start,len(candidates)):
            for gram in candidate_grams[end]:
                size+=1;previous=0
                for i,query_gram in enumerate(query,1):
                    old=lengths[i]
                    lengths[i]=previous+1 if gram==query_gram else max(lengths[i],lengths[i-1])
                    previous=old
            score=5*lengths[-1]/(4*len(query)+size)
            if score>best_score:best_score=score;best=(start,end)
    if best is None:return ''
    start,end=best
    # Preserve intermediate and repeated lines; never append neighbouring verses.
    return '\n'.join(candidates[start:end+1])


def segments(audio,rate):
    import numpy as np
    duration=len(audio)/rate;start=0.;result=[]
    while start<duration:
        if duration-start<=38:end=duration
        else:
            candidates=np.arange(start+24,start+35,.2)
            end=float(min(candidates,key=lambda t:np.mean(audio[int((t-.08)*rate):int((t+.08)*rate)]**2)))
        result.append((start,end));start=end
    return result

def alignment_parts(chunk):
    parts=chunk.get('parts',phrases(chunk.get('text','')))
    if not isinstance(parts,list) or any(not isinstance(part,str) or not part.strip() or len(part)>2000 or '\n' in part or '\r' in part for part in parts):raise ValueError('核对后的歌词句子无效')
    return parts

def transcribe_audio(audio,rate,task,progress):
    import torch
    from qwen_asr import Qwen3ASRModel
    progress('正在加载歌词识别模型',0)
    model=Qwen3ASRModel.from_pretrained(task['asr'],dtype=torch.float16,device_map='mps',attn_implementation='sdpa',max_inference_batch_size=1,max_new_tokens=512)
    chunks=[];windows=segments(audio,rate)
    progress(f'正在识别实际演唱段落 · 已完成 0 / {len(windows)} 段',5)
    for i,(start,end) in enumerate(windows):
        part=audio[round(start*rate):round(end*rate)]
        with torch.inference_mode():raw=model.transcribe(audio=(part,rate),language='Chinese',context='')[0]
        context=reference_candidates(raw.text,task['reference'])
        result=raw
        if context:
            with torch.inference_mode():result=model.transcribe(audio=(part,rate),language='Chinese',context=context)[0]
        chunks.append({'start':start,'end':end,'text':result.text,'rawText':raw.text,'referenceContext':context,'parts':phrases(result.text)});progress(f'正在识别实际演唱段落 · 已完成 {i+1} / {len(windows)} 段',round(5+50*(i+1)/len(windows)))
    del model;gc.collect();torch.mps.empty_cache()
    return chunks

def align_audio(audio,rate,chunks,task,progress):
    import torch
    from qwen_asr import Qwen3ForcedAligner
    progress('正在加载歌词时间定位模型',60)
    model=Qwen3ForcedAligner.from_pretrained(task['aligner'],dtype=torch.float16,device_map='mps',attn_implementation='sdpa');lines=[];unresolved=[]
    progress(f'正在定位每句起止时间 · 已完成 0 / {len(chunks)} 段',60)
    for i,chunk in enumerate(chunks):
        if not 0<=chunk['start']<chunk['end']<=len(audio)/rate+.001:raise ValueError('歌词段落时间范围无效')
        parts=alignment_parts(chunk)
        if parts:
            with torch.inference_mode():words=model.align(audio=(audio[round(chunk['start']*rate):round(chunk['end']*rate)],rate),text='\n'.join(parts),language='Chinese')[0]
            cursor=0
            for text in parts:
                tokens,_=model.aligner_processor.encode_timestamp(text,'Chinese');group=words[cursor:cursor+len(tokens)];cursor+=len(tokens)
                if not group:raise ValueError('模型输出的歌词字数不一致')
                start=round(chunk['start']+group[0].start_time,3);end=round(chunk['start']+group[-1].end_time,3)
                if not chunk['start']<=start<end<=chunk['end']+.05:unresolved.append({'text':text,'window':[chunk['start'],chunk['end']]});continue
                lines.append({'text':text,'start':start,'end':end})
        if parts and cursor!=len(words):raise ValueError('模型输出的歌词字数不一致')
        progress(f'正在定位每句起止时间 · 已完成 {i+1} / {len(chunks)} 段',round(60+35*(i+1)/len(chunks)))
    if not lines or len(unresolved)>len(lines):raise ValueError('本次识别不稳定，未覆盖已有歌词，请重试')
    return {'duration':len(audio)/rate,'lines':lines,'unresolved':unresolved,'transcription':chunks}

def run(task):
    phase=task.get('phase','full')
    if phase not in ('full','transcribe','align'):raise ValueError('歌词处理阶段无效')
    import numpy as np,soundfile as sf,torch,psutil
    torch.set_num_threads(4);torch.manual_seed(0)
    audio,rate=sf.read(task['audio'],dtype='float32',always_2d=True);audio=audio.mean(axis=1);duration=len(audio)/rate
    if not 0<duration<=600:raise ValueError('目前支持 10 分钟以内的歌曲')
    def monitor():
        while True:
            if psutil.Process().memory_info().rss+torch.mps.driver_allocated_memory()>task['budget']:
                print(json.dumps({'error':'歌词模型内存超过预算'}),flush=True);os._exit(75)
            time.sleep(.5)
    threading.Thread(target=monitor,daemon=True).start()
    def progress(message,percent):print(json.dumps({'message':message,'progress':percent},ensure_ascii=False),flush=True)
    if phase=='align':
        reviewed=json.loads(pathlib.Path(task['transcription']).read_text())
        if abs(reviewed['duration']-duration)>.001:raise ValueError('核对歌词与音频时长不一致')
        chunks=reviewed['chunks']
    else:chunks=transcribe_audio(audio,rate,task,progress)
    if phase=='transcribe':result={'duration':duration,'chunks':chunks}
    else:
        result=align_audio(audio,rate,chunks,task,progress)
        result['method']='local-asr-qwen3.8-reference-then-alignment' if phase=='align' else 'reference-context-asr-then-local-alignment'
    pathlib.Path(task['output']).write_text(json.dumps(result,ensure_ascii=False))
    if phase=='transcribe':progress('语音识别完成，等待原词核对',55)
    else:progress('歌词分析完成，等待校验与保存',95)

if __name__=='__main__':
    task=json.loads(sys.stdin.readline())
    def parent_watch():
        while os.read(sys.stdin.fileno(),1):pass
        os._exit(76)
    threading.Thread(target=parent_watch,daemon=True).start()
    try:run(task)
    except Exception as error:print(json.dumps({'error':str(error)},ensure_ascii=False),flush=True);sys.exit(1)
