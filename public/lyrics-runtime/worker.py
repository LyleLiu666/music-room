"""Local lyric transcription. Reference words are model context, not a required sequence."""
import os,sys,json,threading,time,gc,re,pathlib
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'

def phrases(text):
    # Punctuation is only a display boundary, never a semantic matching decision.
    return [part.strip() for part in re.split(r'[，。！？；,.!?;\n]+',text) if part.strip()]

def reference_candidates(transcript,reference,limit=4):
    # Lexical recall ONLY provides optional ASR context. It never replaces output,
    # assigns a lyric occurrence, or chooses a processing action. The audio model
    # decides what was sung, including novel and repeated sections.
    def grams(text):
        chars=''.join(c for c in text if c.isalnum())
        return {chars[i:i+2] for i in range(len(chars)-1)}
    query=grams(transcript)
    candidates=list(dict.fromkeys(line.strip() for line in reference.splitlines() if line.strip() and not line.strip().startswith('[')))
    ranked=sorted(enumerate(candidates),key=lambda pair:len(query & grams(pair[1])),reverse=True)
    anchors=[i for i,line in ranked[:limit] if query & grams(line)]
    indices=sorted({j for i in anchors for j in range(max(0,i-1),min(len(candidates),i+2))})
    return '\n'.join(candidates[i] for i in indices)


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

def run(task):
    import numpy as np,soundfile as sf,torch,psutil
    from qwen_asr import Qwen3ASRModel,Qwen3ForcedAligner
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
    progress('正在识别实际演唱段落',5)
    model=Qwen3ASRModel.from_pretrained(task['asr'],dtype=torch.float16,device_map='mps',attn_implementation='sdpa',max_inference_batch_size=1,max_new_tokens=512)
    chunks=[];windows=segments(audio,rate)
    for i,(start,end) in enumerate(windows):
        part=audio[round(start*rate):round(end*rate)]
        with torch.inference_mode():raw=model.transcribe(audio=(part,rate),language='Chinese',context='')[0]
        context=reference_candidates(raw.text,task['reference'])
        result=raw
        if context:
            with torch.inference_mode():result=model.transcribe(audio=(part,rate),language='Chinese',context=context)[0]
        chunks.append({'start':start,'end':end,'text':result.text,'rawText':raw.text,'referenceContext':context});progress('正在识别实际演唱段落',round(5+50*(i+1)/len(windows)))
    del model;gc.collect();torch.mps.empty_cache()
    progress('正在定位每句起止时间',60)
    model=Qwen3ForcedAligner.from_pretrained(task['aligner'],dtype=torch.float16,device_map='mps',attn_implementation='sdpa');lines=[];unresolved=[]
    for i,chunk in enumerate(chunks):
        parts=phrases(chunk['text'])
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
        progress('正在定位每句起止时间',round(60+35*(i+1)/len(chunks)))
    if not lines or len(unresolved)>len(lines):raise ValueError('本次识别不稳定，未覆盖已有歌词，请重试')
    pathlib.Path(task['output']).write_text(json.dumps({'duration':duration,'lines':lines,'unresolved':unresolved,'transcription':chunks,'method':'reference-context-asr-then-local-alignment'},ensure_ascii=False))
    progress('同步歌词已生成',100)

if __name__=='__main__':
    task=json.loads(sys.stdin.readline())
    def parent_watch():
        while os.read(sys.stdin.fileno(),1):pass
        os._exit(76)
    threading.Thread(target=parent_watch,daemon=True).start()
    try:run(task)
    except Exception as error:print(json.dumps({'error':str(error)},ensure_ascii=False),flush=True);sys.exit(1)
