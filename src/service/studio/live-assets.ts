export const liveProfile={id:'magenta-realtime-2-small-mlx',program:'magenta-rt==2.0.3',mlx:'0.31.1',revision:'010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc'};
export const liveAssets=[
 ["resources/musiccoca/audio_preprocessor.tflite",8729640,"656ca4c358451c2b85932e66efcfd2ba62492f4435953d775bfc1d3c08329a30"],
 ["resources/musiccoca/mapper.tflite",86166664,"2f9743cc8f121a588b69c7f4d79a2a4111ce81864cbde8830054cd5e97f3d717"],
 ["resources/musiccoca/music_encoder.tflite",370935584,"0d4501af799834e383d904c34ee826c61eb53c69682bf15a981a46c1bb32793a"],
 ["resources/musiccoca/pretrained_vector_quantizer.tflite",72422108,"7a8a19e2119ad405818eae84a331a970f1a582b3389d4bfd27814f75b455a444"],
 ["resources/musiccoca/spm.model",517448,"ff325a99b61ba5726cf6437cde6eefbb633dbaa363a684f7a97ed99b55202cca"],
 ["resources/musiccoca/text_encoder.tflite",418674324,"e1222e3418cbe8cc2623939571bae8e9ab6f0d511404b0d83da69f4e6e11b272"],
 ["resources/spectrostream/decoder.safetensors",209853216,"0ac6f100a24945fb434783fde6acd7902ceaa8bca492ca317edfc75dd51c42dd"],
 ["resources/spectrostream/encoder.safetensors",37013392,"f20c197ddcbb9cd43e1a97f9bee0d07d211f79966cd3862d9830a32885090f72"],
 ["resources/spectrostream/quantizer.safetensors",67108984,"0ba89dcb85344bb14f4f34b8f597c0d6adaa560002d4fd88879a2944c98a20f0"],
 ["resources/spectrostream/spectrostream_encoder.mlxfn",104319983,"887c25b21aa1714d19907fc96963c6440d5911f11571054cd5acf7306c260905"],
 ["models/mrt2_small/mrt2_small.mlxfn",455654550,"1a70b0de30b3e6ad054fe6a61a7765408f01127628e6362c1abc328809a3c422"],
 ["models/mrt2_small/mrt2_small_state.safetensors",8676998,"23f1e05a6beea306fe39970bd61193f2d3e5fbd8f08af93570bda4ca9ec33255"],
] as const;
export const liveRequirements=`absl-py==1.4.0
ai-edge-litert==2.4.0
aiofiles==25.1.0
aiohappyeyeballs==2.7.1
aiohttp==3.14.5
aiosignal==1.4.0
anyio==4.16.0
attrs==26.1.0
backports-strenum==1.3.1
certifi==2026.11.20
cffi==2.1.1
charset-normalizer==3.5.3
click==8.5.1
cloudpickle==3.1.3
cryptography==50.0.2
decorator==5.3.2
einops==0.8.2
etils==1.15.0
filelock==4.3.1
flatbuffers==25.12.19
flax==0.12.12
frozenlist==1.8.0
fsspec==2026.9.0
gcsfs==2026.10.1
google-api-core==2.44.0
google-auth==2.63.1
google-auth-oauthlib==1.5.0
google-cloud-core==2.8.0
google-cloud-storage==3.17.2
google-cloud-storage-control==1.17.0
google-crc32c==1.9.0
google-resumable-media==2.11.0
googleapis-common-protos==1.76.0
grpc-google-iam-v1==0.14.6
grpcio==1.85.3
grpcio-status==1.85.3
h11==0.16.0
hf-xet==1.8.0
httpcore2==2.16.2
httpx2==2.16.2
huggingface-hub==2.4.0
humanize==4.17.0
idna==3.20
jax==0.12.1
jaxlib==0.12.1
jaxtyping==0.3.11
joblib==1.6.0
lazy-loader==0.6
librosa==1.0.1
llvmlite==0.50.0
magenta-rt==2.0.3
markdown-it-py==4.3.0
mdurl==0.1.2
ml-dtypes==0.7.0
mlx==0.31.1
mlx-metal==0.31.1
msgpack==1.2.4
multidict==7.2.1
narwhals==2.29.0
numba==0.68.1
numpy==2.3.5
oauthlib==4.0.1
opentelemetry-api==1.45.2
opt-einsum==3.4.0
optax==0.2.9
orbax-checkpoint==0.12.12
packaging==26.4
platformdirs==4.14.8
pooch==1.9.0
prometheus-client==0.26.0
propcache==0.5.4
proto-plus==1.29.0
protobuf==7.36.2
psutil==7.2.2
pyasn1==0.6.5
pyasn1-modules==0.4.2
pycparser==3.12
pygments==2.21.0
pyyaml==6.0.4
recurrentgemma==1.0.1
requests==2.34.2
requests-oauthlib==2.0.0
resampy==0.4.3
rich==15.0.0
safetensors==0.8.0
scikit-learn==1.9.1
scipy==1.18.1
sentencepiece==0.2.3
simple-term-menu==1.6.6
simplejson==4.3.0
soundfile==0.14.0
soxr==1.1.0
tensorstore==0.1.86
threadpoolctl==3.8.0
tqdm==4.70.1
treescope==0.1.11
truststore==0.10.5
typeguard==2.13.3
typing-extensions==4.16.0
urllib3==2.8.0
uvloop==0.23.0
wadler-lindig==0.1.8
yarl==1.25.1
zipp==4.1.2
`;

// Files form a single-request mailbox owned by this session. The worker runs until its supervisor exits.
export const liveWorker=`import json
import os
from pathlib import Path
import sys
import time

import mlx.core as mx
import numpy as np
from magenta_rt import MagentaRT2StdMlxfn
from magenta_rt.config import MUSICCOCA

root = Path(sys.argv[1])
mx.set_memory_limit(int(sys.argv[2]))
mx.set_cache_limit(256 * 1024 * 1024)
mx.random.seed(int(sys.argv[3]))
model = MagentaRT2StdMlxfn(size='mrt2_small', temperature=1.3, top_k=40,
    cfg_scales={'musiccoca': 3.0, 'notes': 1.0, 'drums': 1.0})
embeddings = {}
state = None
previous_mix = None
(root / 'ready').touch()
while True:
    incoming = root / 'request.json'
    if not incoming.exists():
        time.sleep(.015)
        continue
    request = json.loads(incoming.read_text())
    incoming.unlink()
    values = []
    for prompt in (request['left'], request['right']):
        if prompt not in embeddings:
            if len(embeddings) >= 8:
                embeddings.pop(next(iter(embeddings)))
            embeddings[prompt] = model.embed_style(prompt, use_mapper=True)
        values.append(embeddings[prompt])
    target = request['mix']
    if previous_mix is None:
        previous_mix = target
    chunks = []
    for step in range(1, 6):
        mix = previous_mix + (target - previous_mix) * step / 5
        style = np.asarray((1 - mix) * values[0] + mix * values[1], dtype=np.float32)
        audio, state = model.generate(conditioning={MUSICCOCA.key: style}, frames=5, state=state)
        chunks.append(audio.samples)
    previous_mix = target
    samples = np.concatenate(chunks)
    if samples.shape != (48000, 2) or not np.isfinite(samples).all():
        raise RuntimeError('Magenta PCM shape is invalid')
    # Normalize exactly to the codec's signed 16-bit format.
    pcm = (np.clip(samples, -1, 32767 / 32768) * 32768).astype('<i2')
    partial = root / 'response.partial'
    partial.write_bytes(pcm.tobytes())
    os.replace(partial, root / 'response.pcm')
`;
