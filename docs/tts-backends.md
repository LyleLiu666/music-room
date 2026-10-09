# IndexTTS 2.0 推理后端选择

2026-10-09 核查公开源码及发布包。目标是保留当前四个音色、情绪描述和 IndexTTS 2.0 权重，在 16 GB 机器可用。内存实测见 [内存诊断](tts-memory.md)。

## 当前选择

正式服务继续使用固定原版后端，先落实参考特征预编码、按需情绪分析、半精度 GPT 和缓存回收。现成 C++ 与 ONNX 实现都有功能或验证缺口，尚不能直接替换。没有实测它们的本机推理峰值，不能用文件大小或实现语言推算内存收益。

## 原生 C++

[RapidSpeech.cpp 固定源码](https://github.com/RapidAI/RapidSpeech.cpp/tree/f3b08460c937a9a039f736565ed6e0812b1a6006) 是优先候选：有真实 IndexTTS 2.0 全链实现、Metal 声码器和情绪接口。

接入前需要补齐文档引用但未交付的权重转换脚本、完整预编码参考特征接口，减少声码器重复权重，核实授权声明，并删除情绪输入词表对模型判断的覆盖。其默认扩散步数低于原版，比较时须先保持相同的 25 步。

[llama.cpp 的官方 TTS](https://github.com/ggml-org/llama.cpp/blob/8a1a9b5126126e5228b95fa909d4b08fac65e8b3/tools/tts/README.md) 当前提供 Qwen3-TTS、Pocket TTS 的入口，没有当前 IndexTTS 2.0 全链入口。更换这些模型属于产品模型变更。[vllm.cpp 的 IndexTTS 文档](https://github.com/mudler/vllm.cpp/blob/41705a7a25a3bb144e9a05193456b8aaab62fb09/docs/models/indextts-2-5.md) 针对 2.5，明确情绪与质量验证未完成，当前不选用。

## ONNX

[vra/indextts-onnx 固定源码](https://github.com/vra/indextts-onnx/tree/943032da5b3b1e62203bc125c2801095210c948c) 有 2.0 导出与推理实现。核查的 PyPI 0.3.0 发布包硬编码 CPU，加载十个网络，没有当前情绪描述接口或磁盘音色预编码；默认扩散从 25 步降为 10 步。[发布权重](https://huggingface.co/yunfengwang/indextts-onnx/tree/fc91c0a02b344f97da981eae5d466477daeb454b) 约 3.29 GiB 是文件大小，包含三份 GPT 图，不是运行内存。

接入前需恢复原版前处理与情绪链路，修正会覆盖 DiT/BigVGAN 的量化范围，逐图验证导出接口。官方样音的 CPU 对照已证明其声纹前处理与原版不等价；尚未据此推断最终音色评分。

[CoreML 执行器](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html) 有算子与动态形状边界，启用它不能证明全图走 GPU。先建立 CPU 等价基线，再逐图核实加速与回退；需要时将已验证编排迁到 ONNX Runtime C++。

## 候选后端验收

从当前固定权重自行转换，先保持原精度/原步数，验证参考特征、GPT、mel 与声码器，再评估量化。覆盖四音色、情绪、短句、长文、连续任务和取消；同时核实发音、音色与听感。记录加载、生成峰值和结束驻留占用，并在实际 16 GB 机器验收。通过后才能接入正式服务。
