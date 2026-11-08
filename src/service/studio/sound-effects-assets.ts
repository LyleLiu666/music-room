import {createHash} from 'node:crypto';
// Fixed Stability AI runtime and weights, first evaluated on Apple M4; see verification-sfx-trial-2026-11-08.md.
export const effectRevision='790793b89ddceea612be9ce42ff6830d18f6fa57';
export const effectArchiveSha='8ff51d41f60e947c749cec7d4103e6e8add83c303ef288193812d6248d431454';
export const effectSourceSha='4562517f8599db0db40f3e137dde60c72a77b01d49baae1c60f36f55dd08abd3';
export const effectWeightsRevision='30cb2644da54bfa63275d1bc7f1fa67fc718680f';
export const effectWeights=[
 {name:'dit_sm-sfx_f16.npz',bytes:919193814,sha256:'7e702d2640699a57fe436ca975fda16832040ba568c1e092c2ae826987558118'},
 {name:'same_s_decoder_f32.npz',bytes:218090820,sha256:'909928a8e6937c1ebe6ac4b729f0462bd3773704a11ea18278e42671dc69bfe4'},
 {name:'t5gemma_f16.npz',bytes:567443068,sha256:'8deb20489f36d9aec539f26c9c67321f99bc5fe300d470435ed6e76be4f16bbd'},
] as const;
// Exact versions of the dependencies used for the local trial. No runtime network access.
export const effectRequirements=`anyio==4.16.0
cffi==2.1.1
click==8.5.1
filelock==4.2.9
fsspec==2026.9.0
h11==0.16.0
hf-xet==1.8.0
httpcore2==2.16.0
httpx2==2.16.0
huggingface-hub==2.4.0
idna==3.20
mlx==0.32.3
mlx-metal==0.32.3
numpy==2.4.6
packaging==26.3
pycparser==3.12
pyyaml==6.0.3
sentencepiece==0.2.3
soundfile==0.14.0
tqdm==4.70.1
truststore==0.10.5
typing-extensions==4.16.0
`;
// Check Darwin process lifetime peak as well as the shared coordinator's group sampling.
export const effectWorker=`import ctypes, json, os, runpy, sys, threading
from pathlib import Path
libproc=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
libproc.proc_pid_rusage.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
def peak():
    data=ctypes.create_string_buffer(296)
    if libproc.proc_pid_rusage(os.getpid(),4,ctypes.byref(data)): raise RuntimeError('无法读取音效模型进程内存')
    return int.from_bytes(data.raw[240:248],sys.byteorder)
def guard():
    while not stop.wait(.1):
        try:
            if peak()>5_000_000_000: raise RuntimeError('音效模型进程峰值超过 5 GB')
        except Exception as e:
            print(str(e),file=sys.stderr,flush=True);os._exit(75)
stop=threading.Event()
threading.Thread(target=guard,daemon=True).start()
import mlx.core as mx
mx.set_memory_limit(4_000_000_000)
mx.set_cache_limit(0)
request=json.loads(Path(sys.argv[1]).read_text())
script=request['script']
sys.path.insert(0,str(Path(script).parent))
sys.argv=[script,'--prompt',request['prompt'],'--dit','sm-sfx','--decoder','same-s','--seconds',str(request['seconds']),'--seed',str(request['seed']),'--out',request['output']]
try:
    runpy.run_path(script,run_name='__main__')
    measured=peak()
    print('SFX_PEAK_BYTES',measured,flush=True)
    if measured>5_000_000_000: raise RuntimeError('音效模型进程峰值超过 5 GB')
finally: stop.set()
`;
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
export const effectProfile={id:'stable-audio-3-small-sfx-mlx-v1',revision:effectRevision,source:effectSourceSha,weights:sha(JSON.stringify(effectWeights)),requirements:sha(effectRequirements),program:sha(effectWorker)};
