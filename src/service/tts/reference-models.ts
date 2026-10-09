// UVR public release weights and matching model parameters, verified before loading.
export const referenceModels=[
  {
    "filename": "UVR-MDX-NET-Voc_FT.onnx",
    "stem": "Vocals",
    "stage": "提取人声，去除配乐",
    "sha256": "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111",
    "type": "MDX",
    "data": {
      "compensate": 1.021,
      "mdx_dim_f_set": 3072,
      "mdx_dim_t_set": 8,
      "mdx_n_fft_scale_set": 7680,
      "primary_stem": "Vocals"
    }
  },
  {
    "filename": "UVR-DeNoise-Lite.pth",
    "stem": "No Noise",
    "stage": "减弱人声底噪",
    "sha256": "0023492fe98c406817b5253965de19ede65d1c147db015a3a428f07602e99571",
    "type": "VR",
    "data": {
      "vr_model_param": "1band_sr44100_hl1024",
      "primary_stem": "Noise",
      "nout": 16,
      "nout_lstm": 128
    }
  },
  {
    "filename": "UVR-DeEcho-DeReverb.pth",
    "stem": "No Reverb",
    "stage": "减弱回声与混响",
    "sha256": "e644028ec82865dc0fe082bc6fea85a43f7c71cfe375caee2da2d154aa661ee7",
    "type": "VR",
    "data": {
      "vr_model_param": "4band_v3",
      "primary_stem": "No Reverb"
    }
  }
] as const;
