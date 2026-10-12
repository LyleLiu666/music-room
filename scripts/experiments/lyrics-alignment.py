"""Isolated real-song experiment. Never writes to the production workspace.
Run with an isolated qwen-asr environment and an explicit experiment directory.
"""
import argparse, dataclasses, hashlib, json, os, pathlib, threading, time, urllib.request


def lyric_lines(text):
    # Bracketed section markers are the explicit YuE lyrics format, not intent routing.
    return [line.strip() for line in text.splitlines() if line.strip() and not (line.strip().startswith('[') and line.strip().endswith(']'))]


def lrc_time(seconds):
    centiseconds = round(seconds * 100)
    return f'{centiseconds // 6000:02d}:{centiseconds // 100 % 60:02d}.{centiseconds % 100:02d}'


def check_service_idle():
    descriptor = pathlib.Path('/Users/liu_y/Music/MusicRoom/.music-room.runtime.json')
    if not descriptor.exists():
        return
    runtime = json.loads(descriptor.read_text())
    request = urllib.request.Request(runtime['url'] + '/api/resource_status', data=b'{}', headers={'Authorization': 'Bearer ' + runtime['token'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        state = json.load(response)
    if state.get('active') or state.get('queued'):
        raise RuntimeError('Production model work is active; stop this experiment before competing for memory')


def run(root, only=None, device='mps'):
    import numpy as np
    import psutil
    import soundfile as sf
    import torch
    from qwen_asr import Qwen3ForcedAligner
    root = pathlib.Path(root).resolve()
    samples = json.loads((root / 'samples.json').read_text())
    check_service_idle()
    torch.set_num_threads(4)
    torch.manual_seed(0)
    process = psutil.Process()
    peak = [0]
    gpu_peak = [0]
    last_check = [0.0]
    stop = threading.Event()
    def monitor():
        while not stop.wait(.2):
            peak[0] = max(peak[0], process.memory_info().rss)
            if device == 'mps': gpu_peak[0] = max(gpu_peak[0],torch.mps.driver_allocated_memory())
            if time.monotonic()-last_check[0]>3:
                try:
                    check_service_idle()
                except Exception as error:
                    print(str(error),flush=True);os._exit(76)
                last_check[0]=time.monotonic()
            if peak[0]+gpu_peak[0] > 12 * 1024**3:
                os._exit(75)
    threading.Thread(target=monitor, daemon=True).start()
    begin = time.monotonic()
    model = Qwen3ForcedAligner.from_pretrained(str(root / 'model'), dtype=torch.float32 if device == 'cpu' else torch.float16, device_map=device, attn_implementation='sdpa')
    print(json.dumps({'loadedSeconds':time.monotonic()-begin,'device':device}), flush=True)
    raw_timestamps = []
    original_fix = model.aligner_processor.fix_timestamp
    def observe_fix(value):
        fixed = original_fix(value)
        raw_timestamps.append({'raw':value.tolist(),'fixed':fixed})
        return fixed
    model.aligner_processor.fix_timestamp = observe_fix
    summaries = []
    try:
        for sample in samples:
            if only and sample['id'] not in only:
                continue
            check_service_idle()
            target = root / sample['id']
            target.mkdir(exist_ok=True)
            lines = lyric_lines(sample['lyrics'])
            text = '\n'.join(lines)
            audio, rate = sf.read(sample['path'], dtype='float32', always_2d=True)
            audio = audio.mean(axis=1)
            if len(audio)/rate > 300:
                raise ValueError('Sample exceeds the published five-minute aligner input limit')
            start = time.monotonic()
            raw_timestamps.clear()
            print(json.dumps({'start':sample['id'],'duration':len(audio)/rate,'lines':len(lines)},ensure_ascii=False), flush=True)
            with torch.inference_mode():
                result = model.align(audio=(audio,rate),text=text,language='Chinese')[0]
            if device == 'mps': torch.mps.synchronize()
            elapsed = time.monotonic()-start
            words = [dataclasses.asdict(word) for word in result]
            # Model returns the supplied tokens; regroup by exact token position. No fuzzy text matching.
            cursor = 0
            rows = []
            for i,line in enumerate(lines):
                expected,_ = model.aligner_processor.encode_timestamp(line,'Chinese')
                group = words[cursor:cursor+len(expected)]
                assert [w['text'] for w in group] == expected, 'Token grouping changed'
                cursor += len(expected)
                rows.append({'index':i,'text':line,'start':group[0]['start_time'],'end':group[-1]['end_time'],'zeroDurationTokens':sum(w['end_time']<=w['start_time'] for w in group)})
            assert cursor == len(words)
            summary = {'id':sample['id'],'title':sample['title'],'version':sample['version'],'duration':len(audio)/rate,'elapsedSeconds':elapsed,'processPeakRSS':peak[0],'metalDriverPeakBytes':gpu_peak[0],'device':device,'lines':len(rows),'tokens':len(words),'zeroDurationTokens':sum(w['end_time']<=w['start_time'] for w in words),'rawTimestampsChanged':sum(a!=b for group in raw_timestamps for a,b in zip(group['raw'],group['fixed'])),'invalidLines':sum(r['start']<0 or r['end']<=r['start'] or r['end']>len(audio)/rate for r in rows),'startRegressions':sum(a['start']>b['start'] for a,b in zip(rows,rows[1:])),'audioSha256':hashlib.sha256(pathlib.Path(sample['path']).read_bytes()).hexdigest(),'accuracyStatus':'not-human-annotated'}
            payload = {'summary':summary,'lines':rows,'words':words,'modelTimestampPostprocessing':list(raw_timestamps)}
            (target/'alignment.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
            (target/'lyrics.lrc').write_text('\n'.join(f'[{lrc_time(r["start"])}]{r["text"]}' for r in rows)+'\n')
            summaries.append(summary)
            (root/'summary.json').write_text(json.dumps(summaries,ensure_ascii=False,indent=2))
            print(json.dumps(summary,ensure_ascii=False),flush=True)
    finally:
        stop.set()


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('--only',action='append');parser.add_argument('--device',default='mps',choices=['cpu','mps']);args=parser.parse_args();run(args.directory,args.only,args.device)
