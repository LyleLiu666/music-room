"""ASR-assisted alignment experiment; no writes to production data.
Segment-to-lyric decisions are supplied in a reviewed manifest, never inferred by keyword routing.
"""
import argparse, contextlib, dataclasses, hashlib, importlib.util, json, os, pathlib, sys, threading, time
sys.dont_write_bytecode=True


def windows(duration, size=40, stride=30):
    if duration<=0 or size<=0 or stride<=0 or stride>size:raise ValueError('invalid windows')
    result=[];start=0
    while start<duration:
        end=min(duration,start+size);result.append((start,end))
        if end==duration:break
        start+=stride
    return result


def merge_rows(lyrics,rows,duration):
    found={}
    for row in rows:
        index=row['index']
        if index in found or index<0 or index>=len(lyrics):raise ValueError('duplicate or invalid line selection')
        found[index]={**row,'text':lyrics[index]}
    lines=[found[i] for i in sorted(found)]
    return {'lines':lines,'unresolved':[{'index':i,'text':line,'reason':'no-reviewed-match'} for i,line in enumerate(lyrics) if i not in found],
            'invalidLines':sum(r['start']<0 or r['end']<=r['start'] or r['end']>duration for r in lines),
            'startRegressions':sum(a['start']>b['start'] for a,b in zip(lines,lines[1:]))}


def apply_timing_corrections(rows,corrections,duration):
    fixed=[dict(row) for row in rows];by_index={row['index']:row for row in fixed};seen=set()
    for change in corrections:
        index=change['index'];start=change['start'];end=change['end']
        if index not in by_index or index in seen or not change.get('evidence') or not 0<=start<end<=duration:raise ValueError('invalid or unsupported timing correction')
        seen.add(index);row=by_index[index]
        row['timingCorrection']={'before':{'start':row['start'],'end':row['end']},'evidence':change['evidence']}
        row.update(start=start,end=end)
    if any(a['start']>b['start'] for a,b in zip(fixed,fixed[1:])):raise ValueError('correction reverses line order')
    return fixed


def alignment_texts(manifest,reference):
    mode=manifest.get('mode','reference-constrained-baseline')
    if mode=='reference-constrained-baseline':return reference
    if mode not in ('performed-draft','reference-guided-performance'):raise ValueError('unknown transcript mode')
    entries=manifest['performedLines']
    if not entries or any(not row['text'].strip() for row in entries):raise ValueError('empty performed text')
    for row in entries:
        if any(i<0 or i>=len(reference) for i in row['referenceLines']):raise ValueError('invalid reference link')
    return [' '.join(reference[i] for i in row['referenceLines']) if mode=='reference-guided-performance' and row['referenceLines'] else row['text'] for row in entries]


def baseline_module():
    spec=importlib.util.spec_from_file_location('baseline',pathlib.Path(__file__).with_name('lyrics-alignment.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


@contextlib.contextmanager
def guard(torch,baseline):
    import psutil
    baseline.check_service_idle();stop=threading.Event();process=psutil.Process();metrics={'processPeakRSS':0,'metalDriverPeakBytes':0};last=[0.]
    def monitor():
        while not stop.wait(.25):
            metrics['processPeakRSS']=max(metrics['processPeakRSS'],process.memory_info().rss)
            metrics['metalDriverPeakBytes']=max(metrics['metalDriverPeakBytes'],torch.mps.driver_allocated_memory())
            if sum(metrics.values())>12*1024**3:
                print('experiment resource limit reached',flush=True);os._exit(75)
            if time.monotonic()-last[0]>3:
                try:baseline.check_service_idle()
                except Exception as e:print(str(e),flush=True);os._exit(76)
                last[0]=time.monotonic()
    thread=threading.Thread(target=monitor,daemon=True);thread.start()
    try:yield metrics
    finally:stop.set();thread.join(timeout=6)


def experiment(root,stage):
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_asr import Qwen3ASRModel,Qwen3ForcedAligner
    root=pathlib.Path(root).resolve();baseline=baseline_module();sample=json.loads((root/'sample.json').read_text());lyrics=baseline.lyric_lines(sample['lyrics']);audio,rate=sf.read(sample['path'],dtype='float32',always_2d=True);audio=audio.mean(axis=1);duration=len(audio)/rate
    torch.set_num_threads(4);torch.manual_seed(0)
    with guard(torch,baseline) as metrics:
        started=time.monotonic()
        if stage=='transcribe':
            model=Qwen3ASRModel.from_pretrained(str(root/'asr-model'),dtype=torch.float16,device_map='mps',attn_implementation='sdpa',max_inference_batch_size=1,max_new_tokens=512)
            print(json.dumps({'asrLoadedSeconds':time.monotonic()-started}),flush=True)
            out=root/'transcription.json';items=json.loads(out.read_text())['chunks'] if out.exists() else []
            for index,(start,end) in enumerate(windows(duration)):
                if any(x['index']==index for x in items):continue
                baseline.check_service_idle();begin=time.monotonic();print(json.dumps({'asrStart':index,'start':start,'end':end}),flush=True)
                with torch.inference_mode():result=model.transcribe(audio=(audio[round(start*rate):round(end*rate)],rate),language='Chinese',context='')[0]
                torch.mps.synchronize();row={'index':index,'start':start,'end':end,'text':result.text,'language':result.language,'elapsedSeconds':time.monotonic()-begin};items.append(row)
                out.write_text(json.dumps({'source':sample,'chunks':items,'context':'empty; original lyrics not supplied to ASR','metrics':metrics},ensure_ascii=False,indent=2));print(json.dumps(row,ensure_ascii=False),flush=True)
        else:
            manifest=json.loads((root/'reviewed-segments.json').read_text());assert manifest['reviewer']=='assistant-semantic-review-not-human-listening'
            reference=lyrics;lyrics=alignment_texts(manifest,reference)
            aligner=Qwen3ForcedAligner.from_pretrained(str(root.parent/'lyrics-alignment-2026-10-12/model'),dtype=torch.float16,device_map='mps',attn_implementation='sdpa')
            raw=[];old_fix=aligner.aligner_processor.fix_timestamp
            def observe(data):
                fixed=old_fix(data);raw.append({'raw':data.tolist(),'fixed':fixed});return fixed
            aligner.aligner_processor.fix_timestamp=observe
            collected=[];details=[];seconds=0
            for segment in manifest['segments']:
                baseline.check_service_idle();start=segment['start'];end=segment['end'];assert 0<=start<end<=duration
                text='\n'.join(p['text'] for p in segment['parts']);begin=time.monotonic();raw.clear()
                with torch.inference_mode():result=aligner.align(audio=(audio[round(start*rate):round(end*rate)],rate),text=text,language='Chinese')[0]
                torch.mps.synchronize();elapsed=time.monotonic()-begin;seconds+=elapsed;words=[dataclasses.asdict(w) for w in result];cursor=0;rows=[]
                for part in segment['parts']:
                    expected,_=aligner.aligner_processor.encode_timestamp(part['text'],'Chinese');group=words[cursor:cursor+len(expected)];assert [w['text'] for w in group]==expected;cursor+=len(expected)
                    row={'index':part['line'],'text':part['text'],'start':round(start+group[0]['start_time'],3),'end':round(start+group[-1]['end_time'],3),'zeroDurationTokens':sum(w['end_time']<=w['start_time'] for w in group),'segment':segment['id']};rows.append(row)
                    if part.get('select'):
                        canonical,_=aligner.aligner_processor.encode_timestamp(lyrics[part['line']],'Chinese');assert expected==canonical,'selected text must match reviewed transcript entry';collected.append(row)
                assert cursor==len(words)
                details.append({'id':segment['id'],'start':start,'end':end,'elapsedSeconds':elapsed,'rows':rows,'words':words,'modelTimestampPostprocessing':list(raw)});print(json.dumps({'aligned':segment['id'],'seconds':elapsed,'selected':sum(bool(p.get('select')) for p in segment['parts'])}),flush=True)
            collected=apply_timing_corrections(collected,manifest.get('timingCorrections',[]),duration)
            merged=merge_rows(lyrics,collected,duration)
            if manifest.get('mode') in ('performed-draft','reference-guided-performance'):
                for row in merged['lines']:row.update({k:v for k,v in manifest['performedLines'][row['index']].items() if k!='text'})
            asr=json.loads((root/'transcription.json').read_text());summary={'id':sample['id'],'title':sample['title'],'version':sample['version'],'duration':duration,'lines':len(merged['lines']),'expectedLines':len(lyrics),'unresolvedLines':len(merged['unresolved']),'invalidLines':merged['invalidLines'],'startRegressions':merged['startRegressions'],'elapsedSeconds':seconds,'asrSeconds':sum(c['elapsedSeconds'] for c in asr['chunks']),'zeroDurationTokens':sum(r['zeroDurationTokens'] for r in merged['lines']),'rawTimestampsChanged':sum(a!=b for s in details for g in s['modelTimestampPostprocessing'] for a,b in zip(g['raw'],g['fixed'])),'audioSha256':hashlib.sha256(pathlib.Path(sample['path']).read_bytes()).hexdigest(),'accuracyStatus':'not-human-annotated','transcriptMode':manifest.get('mode','reference-constrained-baseline'),'referenceLines':len(reference),'matching':'assistant semantic review; reference links optional; matched wording follows reference in reference-guided-performance; not human listening or fully automated',**metrics}
            summary.update({'locallyCorrectedTimingLines':len(manifest.get('timingCorrections',[])),'uncertainTimingLines':sum(r.get('timingStatus')=='uncertain' for r in merged['lines']),'uncertainTextLines':sum(r.get('status')=='uncertain' for r in merged['lines']),'unconfirmedEvents':len(manifest.get('unconfirmedEvents',[])),'publicationStatus':'draft-not-listening-verified'})
            (root/'alignment.json').write_text(json.dumps({'summary':summary,'lines':merged['lines'],'unresolved':merged['unresolved'],'unconfirmedEvents':manifest.get('unconfirmedEvents',[]),'segments':details},ensure_ascii=False,indent=2))
            (root/'lyrics.lrc').write_text('\n'.join(f'[{baseline.lrc_time(r["start"])}]{r["text"]}' for r in merged['lines'])+'\n')
            print(json.dumps(summary,ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('root');parser.add_argument('stage',choices=['transcribe','align']);args=parser.parse_args();experiment(args.root,args.stage)
