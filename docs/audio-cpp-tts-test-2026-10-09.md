# audio.cpp / IndexTTS 2.0：Q8 与 F16 本机测试报告

测试日期：2026-10-09（北京时间）。本报告记录独立试跑，不代表正式服务已更换后端。

## 1. 结论

**audio.cpp 的 Q8 和 F16 均能在本机通过 Metal 生成四个现有音色。F16 值得继续验证，但音质问题尚未解决到可以确认的程度。**

- 用户试听反馈：Q8“好像还行”，随后指出声音“像隔着收音机一样”；F16“有一点改善”。这是本次的主观质量结论，没有盲听评分或多人评测。
- Q8 进程物理内存峰值约 **3.65 GiB**，F16 约 **4.22–4.25 GiB**；F16 增加约 **0.58 GiB**。RSS 峰值分别约 **3.94 GiB** 和 **5.21 GiB**。
- 四个组合的启动至退出总耗时：Q8 **26.86–32.52 秒**，F16 **24.46–36.81 秒**。不同版本输出长度不同，且每个组合仅运行一次，不能宣布哪一个更快。
- 当前证据不能确定“收音机感”由量化造成，也不能证明 F16 已消除该问题。更高精度不等于必然恢复听感。
- 尚未测试长文、情绪控制、模型常驻、连续多任务或实际 16 GB 硬件，不能据此宣布可替换正式后端。

## 2. 测试条件

| 项目 | 设置 |
| --- | --- |
| 硬件 | Apple M4，32 GiB 统一内存，arm64 |
| 系统 | macOS 27.0.1，构建 26A434 |
| 程序 | audio.cpp v0.9.1，构建提交 cf124a67，官方 macOS arm64 Metal 发布包 |
| 模型 | IndexTTS 2.0，GGUF Q8_0 与 F16；未测试 IndexTTS 2.5 或 Orig |
| 推理入口 | `--task clon --family index_tts2 --backend metal --language zh` |
| 固定参数 | `--num-beams 1 --seed 42 --session-option index_tts2.mem_saver=true` |
| 其余参数 | 保持该发布版本默认值；未显式指定扩散步数、采样温度等 |
| 参考音色 | 复用现有四份 WAV；未在本次重新清理或改变参考文件 |
| 音频输出 | 22,050 Hz、单声道、16 位 PCM WAV |
| 运行方式 | 依次启动独立进程；每个音色、精度组合运行一次，共 8 次 |

所有组合朗读同一段文本：

> 你好，欢迎回来。今天的故事从这里开始。

参考文件：

- [官方样音](/Users/liu_y/code/music/public/tts-presets/official.wav)：2.44 秒，48,000 Hz。
- [迪丽热巴](/Users/liu_y/code/music/public/tts-presets/dilireba.wav)：7.63 秒，22,050 Hz。
- [天津团团记](/Users/liu_y/code/music/public/tts-presets/tianjin.wav)：14.81 秒，22,050 Hz。
- [女网红](/Users/liu_y/code/music/public/tts-presets/influencer.wav)：14.98 秒，22,050 Hz。

测试前通过正式服务的只读接口检查任务状态；有任务运行时等待其结束。没有重启服务、替换正式模型或写入用户项目库。

### 2.1 模型与程序来源

[程序发布页](https://github.com/0xShug0/audio.cpp/releases/tag/v0.9.1)；[对应版本的 IndexTTS 文档](https://github.com/0xShug0/audio.cpp/blob/v0.9.1/docs/models/index_tts.md)。

模型来自 [audio-cpp/audio.cpp-gguf 固定快照](https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/a199f1a00ae893af0067caeab51f810de4c728a5/IndexTTS2-GGUF)。两份模型和程序压缩包均已核对 SHA-256。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `audio-v0.9.1-bin-macos-arm64-metal.tar.gz` | 30,519,606 | `960436787b84bf137a70ea1713ac460207ef2ac7b2617380fb7a1f4650d1100d` |
| `index-tts2-q8_0.gguf` | 3,633,888,608 | `f9be73ac5b6cbdc5f603f04dcb6c9fe37b3a301a365a1ea8d580d3ef7ba22e8e` |
| `index-tts2-f16.gguf` | 4,646,898,304 | `0f7b95d3d32e18bf9352912a7b21a0bd4a8406853a0aaa2c9180f77389c21523` |

模型文件约 3.63 GB / 4.65 GB，使用十进制文件大小；下文内存使用 GiB。文件大小不能代替运行内存测量。尚未核实发布者转换前的源权重与当前正式后端固定权重是否逐项一致。

## 3. 实测结果

| 音色 | 精度 | 输出时长（秒） | 总耗时（秒） | 程序任务计时（秒） | 物理占用峰值（GiB） | RSS 峰值（GiB） |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 官方样音 | Q8 | 4.725 | 27.16 | 13.57 | 3.65 | 3.94 |
| 官方样音 | F16 | 5.108 | 24.46 | 15.04 | 4.22 | 5.21 |
| 迪丽热巴 | Q8 | 4.563 | 26.86 | 18.40 | 3.64 | 3.94 |
| 迪丽热巴 | F16 | 4.133 | 27.27 | 17.41 | 4.23 | 5.21 |
| 天津团团记 | Q8 | 4.133 | 32.52 | 23.26 | 3.66 | 3.94 |
| 天津团团记 | F16 | 4.052 | 36.49 | 26.05 | 4.25 | 5.21 |
| 女网红 | Q8 | 3.889 | 29.63 | 21.11 | 3.66 | 3.94 |
| 女网红 | F16 | 4.052 | 36.81 | 25.37 | 4.24 | 5.21 |

**计量口径：**总耗时来自测试脚本的进程启动至退出，包含模型加载、生成、释放和监测等待开销，不包含下载时间。程序任务计时来自 `metrics.wall_ms`，与包含加载的总耗时不是同一口径，也没有进一步拆分为纯神经网络计算时间。系统文件缓存未清空，所以这里的独立进程加载不等于磁盘缓存完全冷启动。

物理占用采用程序记录的 macOS `phys_footprint` 峰值；RSS 单独列出，不能与物理占用相加。本次记录单个推理进程，不是整机内存，也不是单独的 GPU 活跃张量。测试脚本另约每两秒调用一次 `vmmap` 交叉观察；此前口头汇报的 Q8 3.6–3.7 GiB 来自其较粗的显示值，表格采用程序更精确的峰值日志。

### 3.1 试听文件

| 音色 | Q8 | F16 |
| --- | --- | --- |
| 官方样音 | [试听 Q8](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/official-metal.wav) | [试听 F16](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/official-metal-f16.wav) |
| 迪丽热巴 | [试听 Q8](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/dilireba-metal.wav) | [试听 F16](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/dilireba-metal-f16.wav) |
| 天津团团记 | [试听 Q8](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/tianjin-metal.wav) | [试听 F16](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/tianjin-metal-f16.wav) |
| 女网红 | [试听 Q8](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/influencer-metal.wav) | [试听 F16](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/influencer-metal-f16.wav) |

八份文件均已检查为非空、有效的单声道 PCM WAV；这些结构检查不代表听感合格。部分输出有少量采样触及 16 位 PCM 上限，最高约 0.0101%，尚未确认与用户描述的听感有关。

### 3.2 对音质问题的判断

用户确认 F16 仅有一点改善，报告不将其写成“恢复原版音质”或“解决收音机感”。

本次曾对 Q8、参考素材和此前原后端短句输出做粗略频谱检查，未发现所有 Q8 输出统一缺失高频的情况。这不能排除失真、声音发闷或细节损失，也不能作为主观听感的反证。原后端迪丽热巴样本还带有“平静、温暖”的情绪条件，其他推理设置也未完全对齐，因此本报告不把它当成严格的后端质量或速度基线。

直接读取 Q8 GGUF 的张量信息可见，该文件是混合精度：部分矩阵使用 Q8，BigVGAN 波形还原模块的已列权重仍为 F32。不能把所有音质差异简单归因于“整个模型都降到了 8 位”。参考素材、转换权重、前处理、生成参数和 Metal 数值路径仍需进一步对照。

## 4. 后续验证建议

1. **先定位音质差异。** 固定干人声、文本、情绪条件与生成设置，对照正式后端、audio.cpp F16 和 Q8；补充较长语句、数字和停顿，重复生成后做盲听。如果 F16 仍不满意，再试 Orig，并用 CPU 对照排查 Metal 路径。
2. **再验证持续运行。** 测试同音色复用、切换四音色、连续任务、长文、情绪控制、取消和失败回收，记录每次任务结束后的驻留内存。独立进程峰值不能证明常驻模型不会累积内存。
3. **最后验收 16 GB 机器。** 在真实目标硬件、常用应用同时开启的环境下验证内存压力、交换和响应速度，通过后再讨论正式接入。

本次建议是保留 F16 作为下一轮质量验证候选，不据短句结果直接替换正式服务。

## 5. 原始记录与复现

- [Q8 汇总](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/summary.json)
- [F16 汇总](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/summary-f16.json)
- [频谱初步记录](/Users/liu_y/code/music/test-results/audio-cpp-trial/outputs/spectral-baseline.json)
- [独立运行与内存监测脚本](/Users/liu_y/code/music/test-results/audio-cpp-trial/run_trial.py)

每段音频同目录保留同名 `.log` 和 `.json`，包含完整命令、退出码、耗时、内存采样和程序指标。模型、程序与试听文件位于 `/Users/liu_y/code/music/test-results/audio-cpp-trial`，属于本机测试产物；报告进入版本库并不意味着这些大文件也已归档或推送。

脚本用法（需要正式服务启动且没有待处理任务；运行会覆盖对应测试输出）：

```bash
python3 /Users/liu_y/code/music/test-results/audio-cpp-trial/run_trial.py dilireba metal q8_0
python3 /Users/liu_y/code/music/test-results/audio-cpp-trial/run_trial.py dilireba metal f16
```

脚本的 14 GiB / 600 秒停止条件是测试保护阈值，不是模型的运行内存保证。其他背景资料见 [正式后端内存诊断](/Users/liu_y/code/music/docs/tts-memory.md) 和 [后端候选说明](/Users/liu_y/code/music/docs/tts-backends.md)；它们不由本报告自动更新。
