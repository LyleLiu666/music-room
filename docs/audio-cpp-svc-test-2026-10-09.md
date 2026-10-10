# Mac 原生 Seed-VC 歌声转换实测

测试日期：2026-10-09 至 2026-10-10（北京时间）。早期为独立 CLI 实验；目前已接入 Music Room 的单机离线音色转换功能，并完成一首完整歌曲的真实服务验收。

## 1. 结论

**Q8 / F16 + Metal + Seed-VC `v1_svc` 均能执行，纯原生推理、无需逐音色训练。F16 已在真实页面对应的服务中完成完整 211.718 秒歌曲的人声分离、龚琳娜参考换声和立体声背景回混，总耗时 23 分 49.6 秒。**

- 在 Apple M4、32 GiB 内存上，10 秒短片段的 Seed-VC 进程物理内存峰值约 2.15–2.39 GiB，Metal 缓冲区分配观测峰值约 3.06–3.27 GiB。两项口径不同、存在共享内存重叠，不能相加。
- Q8 三轮约 89–97 秒；F16 的 10 秒样例约 70–73 秒。单轮各跑一次，运行次序、编译缓存、后台应用和部分模型下载都会影响速度，不能据此宣布量化模型普遍更慢。
- 两份不同参考 WAV 都能直接完成转换；没有训练、微调、PyTorch 推理或普通 VC 路线替代。
- 用户试听 Q8 混音直转：**伴奏消失，人声不清晰、听不出歌词，但调子大致正确。** 用户试听 F16 同输入：**比 Q8 好一些，结尾有杂音和被掐断感。** 这是本次主观证据，不扩展为全部歌曲或所有音色的结论。
- 后续补充原生 HTDemucs 人声分离、F16 换声、背景回混及边界处理后，用户给沈腾小样约 70 分，并认为龚琳娜小样可以保留，但相似度仍不够。完整莫文蔚歌曲已通过时长、格式、拼接和立体声保留验证，用户试听认为效果可以，保留当前方案。

**判断：已可提供单机离线音色转换功能。主要瓶颈仍是音色相似度、演唱表现保留造成的风格差异，以及约 6.75 倍音频时长的处理时间。** 这次完整任务的物理内存峰值约 2.41 GiB，Metal 分配观测峰值约 3.58 GiB，系统未发生新增 swap-out。两种内存口径有重叠，不能相加。此结论仅覆盖本机单任务；并发吞吐和长期连续运行尚未验证。

## 2. 环境、模型与真实运行路径

| 项目 | 实测 |
| --- | --- |
| 硬件 | MacBook Pro，Apple M4，10 核 CPU / 10 核 GPU，32 GiB 统一内存 |
| 系统 | macOS 27.0.1，26A434；Metal 4 |
| 工具链 | Apple Command Line Tools；CMake 4.4.0；没有独立 `xcrun metal` |
| audio.cpp 提交 | `bd88e6eaa1d25a1ee1513e19e72e72a5de757187` |
| 模型仓库快照 | `audio-cpp/audio.cpp-gguf`，`a199f1a00ae893af0067caeab51f810de4c728a5` |
| 路线 | `--task svc --family seed_vc --task-route v1_svc --backend metal` |
| 固定参数 | 30 步、seed 42、F0 开启、自动调音关闭、移调 0、长度倍率 1 |
| 输出 | 原始转换 WAV 为 44,100 Hz、单声道、16 位 PCM |

包 ID 来自项目 model manager：`seed_vc_mlx_q8_0`、`seed_vc_mlx_f16`。直接解析 Q8 GGUF，确认其中包含 `v1_svc_weights`、`rmvpe_weights`、`whisper_small_weights`、`campplus_weights`、`bigvgan_44k_weights` 及对应配置；不只是 V2 VC 权重。

| 模型 | 文件字节数 | SHA-256 |
| --- | ---: | --- |
| Seed-VC Q8 | 3,120,809,248 | `d4a1ecf951cb7c2ebb55347a174a286a3b23825d58f8835707d21d754762ca7f` |
| Seed-VC F16 | 3,629,186,560 | `03740be5b4b55ae677c34d63514ff879aaedd6a77fd31773938166fb84debf93` |
| HTDemucs F16 | 84,059,168 | `f8c54ba35df95aafea7881eac214b58ec18a73cbcb6ff5a90f4b762631a286b6` |

Q8/F16 均完成 SHA-256 与 Hugging Face LFS 标识的比对。文件大小使用十进制 GB，运行内存使用 GiB，不能混用。Q8 包本身是混合存储精度，不等于所有组件都是 8 位。

CLI `--list-devices` 返回 `MTL:0 Apple M4`，`--list-loaders --json` 确认 `seed_vc` 的 `svc` loader；实际推理日志包含 Metal 运算内核，运行时调用栈也落在 `run_v1_singing_voice_conversion`、BigVGAN 和 Metal command buffer 上。未运行 CPU 对照，因为 Metal 路径没有失败。

Seed-VC 与 HTDemucs 使用 C++ 原生 Metal 推理，不依赖 PyTorch。实验脚本中的 Python 用于下载、监测、WAV 和混音；龚琳娜参考的额外去混响使用 ONNX Runtime CPU，详见第 8 节。

### 2.1 构建时遇到的问题

1. 上游子模块使用 SSH URL，本机未配置相应 SSH 凭据；以命令局部的 HTTPS URL 重写完成克隆，没有修改全局 Git 配置。
2. Python 的默认 TLS 证书路径失效；指定 `SSL_CERT_FILE=/etc/ssl/cert.pem`，保留证书校验。
3. `scripts/build_metal.sh` 因找不到独立 Metal 编译器提前退出。直接使用 CMake，开启内嵌 Metal 源码后可以构建并由 Metal 运行时编译，无需改动推理实现。
4. 上游常规缓冲区分配日志处于注释状态。首轮使用未修改二进制；随后恢复一行 `currentAllocatedSize` 日志，补丁存为 `metal-memory-logging.patch`。
5. 按用户要求，将 DiT 总生成窗口由 30 秒调整为 45 秒，保留参考截断上限 25 秒与 Whisper 单段输入上限 30 秒。独立补丁为 `test-results/seed-vc-trial/seed-vc-context45.patch`。本次完整服务任务使用该版本。

## 3. 输入与试听

实验目录：`/Users/liu_y/code/music/test-results/seed-vc-trial`。大模型和 WAV 是本机实验产物，不随此报告自动提交。

- 公开干声 A：Seed-VC 上游 `TECHNOPOLIS - 2085 [vocals]_[cut_14sec].wav`，截取前 10 秒、立体声平均为单声道。
- 参考 B1：上游 `s1p1.wav` 前 10 秒，普通说话样例，具体人物未标明。**不是周杰伦、迪丽热巴或沈腾。**
- 参考 B2：上游 `s2p1.wav` 前 10 秒。
- 用户歌曲：`/Users/liu_y/Downloads/AP4HLCDfum##1.m4a`，约 238.28 秒。转为 44.1 kHz PCM 单声道，先测试 60–70 秒；不是干声。
- 上游素材固定提交：`51383efd921027683c89e5348211d93ff12ac2a8`；精确下载地址和输入哈希见 `inputs/provenance.json`、`inputs/audio-info.json`。

| 内容 | 文件 |
| --- | --- |
| 原始干声 A | [source.wav](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/source.wav) |
| 目标参考 B1 | [reference.wav](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/reference.wav) |
| 第二目标 B2 | [reference2.wav](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/reference2.wav) |
| 干声 → B1，Q8 | [Q8](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/q8_0-metal-source-reference-30.wav) |
| 干声 → B1，F16 | [F16](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/f16-metal-source-reference-30.wav) |
| 干声 → B2，Q8 | [更换参考](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/q8_0-metal-source-reference2-30.wav) |
| 用户歌曲原始 60–70 秒 | [原音](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/user-song-60s.wav) |
| 用户歌曲混音直转，Q8 | [Q8 直转](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/q8_0-metal-user-song-60s-reference-30.wav) |
| 用户歌曲混音直转，F16 | [F16 直转](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/f16-metal-user-song-60s-reference-30.wav) |
| 分离后的原人声 | [vocals.wav](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/stems/vocals.wav) |
| 分离后转换，未处理结尾 | [F16 分离后转换](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/f16-metal-user-vocals-reference-30.wav) |
| 带前后余量转换、裁切淡出后的人声 | [处理后人声](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-vocals.wav) |
| 恢复伴奏的试听版 | [带伴奏试听](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-with-accompaniment.wav) |

### 3.1 音质与结尾处理边界

10 秒输入的原始 SVC 输出为 9.99619 秒，只能说明总时长基本保持；不能据此证明歌词、节奏细节或音高逐帧正确。用户确认混音直转的大致旋律正确，但歌词清晰度失败；F16 有小幅主观改善。高音、气声、颤音、咬字及目标人物相似度尚未逐项验收。

公开干声 → B1 的 Q8 输出约 0.261% 采样触及 PCM 上限，F16 约 0.248%；该原始干声没有触顶。用户歌曲直转 Q8 未触顶。这些是信号检查，不是听感评分；不能通过事后降低音量恢复已经削掉的峰值。

用户歌曲原片段最后一个采样为 -0.159（满幅归一化），F16 直转末样为 -0.047、末 20 ms 峰值 0.749，均非自然静音。硬切本身可造成突变，但无法据此排除模型生成的杂音。

追加处理：对原曲 58–72 秒先分离再转换，裁取中间对应 60–70 秒，首尾各作 20 ms 淡变，末尾补 100 ms 静音。伴奏使用分离得到的 drums + bass + other；转换人声按分离前人声的片段 RMS 调整混入音量，最终整段等比衰减以避免新削波。回混人声增益约 0.601；最终回混峰值约 0.957，无新增触顶采样。14 秒原始生成中有 1 个采样触顶，后处理不能恢复已经发生的削波。没有人为校正音高，也没有精确估计生成延迟。**这是试听边界处理，不能声称修复了模型内部的歌词、发音或末尾生成缺陷。**

未做 15 步对照：30 步音质尚未验收，先处理输入和边界问题，再讨论减少步数。

## 4. 资源结果

以下表格由每轮独立日志汇总。总耗时包含进程启动、加载、准备、执行、退出及监测采样等待；RTF = 总耗时 / 输入秒数。`session.wall_ms` 只计已准备会话的运行阶段，未进行常驻会话重复基准测试。

| 测试 | 总耗时秒 | 总 RTF | 会话执行秒 | 物理峰值 GiB | Metal 分配 GiB | 新增 swap-out 页 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| F16 干声 → B1（10秒） | 73.42 | 7.34 | 50.52 | 2.38 | 3.27 | 0 |
| F16 用户混音直转（10秒） | 72.23 | 7.22 | 47.36 | 2.39 | 3.27 | 0 |
| F16 带余量分离人声（14秒） | 87.39 | 6.24 | 65.01 | 2.40 | 3.37 | 0 |
| F16 分离人声（10秒） | 69.76 | 6.98 | 46.57 | 2.39 | 3.27 | 0 |
| Q8 干声 → B1（10秒） | 90.5 | 9.05 | 65.92 | 2.15 | 未测 | 0 |
| Q8 干声 → B2（10秒） | 89.31 | 8.93 | 63.08 | 2.16 | 3.06 | 0 |
| Q8 用户混音直转（10秒） | 96.66 | 9.67 | 68.48 | 2.15 | 3.06 | 0 |
| HTDemucs 分离（10秒） | 3.94 | 0.39 | 2.38 | 0.47 | 0.44 | 0 |
| HTDemucs 分离（14秒） | 5.12 | 0.37 | 3.51 | 0.48 | 0.44 | 0 |


计量说明：

- 物理峰值来自程序的 macOS `phys_footprint` 高水位；日志虽命名 `peak_footprint_mb`，源码使用 `>> 20`，实际单位是 MiB。另用 `vmmap -summary` 约每 0.5 秒加命令开销采样复核。
- RSS 单独保存在 `summary.json`，不代替 GPU 或统一内存占用。
- Metal 值是 ggml 分配缓冲区后查询同一进程 `MTLDevice.currentAllocatedSize` 的最大观测值，反映分配而非全部物理驻留；不是完整 GPU 仪器级峰值，也不能与 `phys_footprint` 相加。
- M4 推荐 Metal 工作集约 26.8 GB 是设备预算，不是本任务用量。
- 首轮测试前系统已有约 3,926 MiB（3.83 GiB）的 swap 使用，所有短片段轮次检查 `vm_stat` 的 swap-out 增量。系统统计不是进程独占统计，无法把其他应用的换入换出归因到本模型。
- 保护阈值为采样到物理占用超过 10 GiB 或单次超过 600 秒就终止，属于实验保护，不是严格实时内存上限。
- 模型顺序加载、分离与 SVC 串行执行，未同时驻留两种模型。后台其他应用保持原状。

## 5. 复现

完整命令记录见每轮 JSON 的 `command`，监测脚本见 [run_trial.py](/Users/liu_y/code/music/test-results/seed-vc-trial/run_trial.py)。基础脚本见 [reproduce.sh](/Users/liu_y/code/music/test-results/seed-vc-trial/reproduce.sh)，混音与边界处理见 [mix_preview.py](/Users/liu_y/code/music/test-results/seed-vc-trial/mix_preview.py)。

```bash
mkdir -p /Users/liu_y/code/music/test-results/seed-vc-trial
cd /Users/liu_y/code/music/test-results/seed-vc-trial
# 新目录首次安装：
git -c url.https://github.com/.insteadOf=git@github.com: clone --recurse-submodules https://github.com/0xShug0/audio.cpp.git
cd audio.cpp
git checkout bd88e6eaa1d25a1ee1513e19e72e72a5de757187
git -c url.https://github.com/.insteadOf=git@github.com: submodule update --init --recursive
cmake -S . -B build/macos-metal-release \
  -DCMAKE_BUILD_TYPE=Release -DAUDIOCPP_MODEL_SET=custom \
  '-DAUDIOCPP_MODELS=seed_vc;htdemucs' \
  -DENGINE_ENABLE_METAL=ON -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON -DENGINE_ENABLE_OPENMP=OFF
cmake --build build/macos-metal-release --target audiocpp_cli -j 6
build/macos-metal-release/bin/audiocpp_cli --list-devices
build/macos-metal-release/bin/audiocpp_cli --list-loaders --json
python3 tools/model_manager_v2.py info seed_vc --json
SSL_CERT_FILE=/etc/ssl/cert.pem python3 tools/model_manager_v2.py install seed_vc_mlx_q8_0 --models-root ../models
SSL_CERT_FILE=/etc/ssl/cert.pem python3 tools/model_manager_v2.py install seed_vc_mlx_f16 --models-root ../models
SSL_CERT_FILE=/etc/ssl/cert.pem python3 tools/model_manager_v2.py install htdemucs_f16 --models-root ../models
# 下载默认 main；必须核对上表 SHA-256，避免以后模型变化影响复现。
shasum -a 256 ../models/SeedVC-MLX-GGUF/*.gguf

BIN=build/macos-metal-release/bin/audiocpp_cli
"$BIN" --task svc --family seed_vc --task-route v1_svc \
  --model ../models/SeedVC-MLX-GGUF/seed-vc-mlx-q8_0.gguf \
  --backend metal --audio ../inputs/source.wav --voice-ref ../inputs/reference.wav \
  --out ../converted.wav --num-inference-steps 30 --seed 42 \
  --request-option f0_condition=true --request-option auto_f0_adjust=false \
  --request-option semitone_shift=0 --request-option length_adjust=1.0 --metrics --log

# 人声分离；输入为 44.1 kHz WAV。
"$BIN" --task sep --family htdemucs \
  --model ../models/HTDemucs-GGUF/htdemucs-f16.gguf --backend metal \
  --audio ../inputs/user-song-context.wav --out-dir ../outputs/stems-user-song-context \
  --metrics --log
# SVC 改用分离出的 vocals.wav 和 F16 权重，其他参数保持相同。
```

若需要单独 Metal 分配日志，构建前应用实验目录的 `metal-memory-logging.patch`。未修改上游二进制保留为 `audiocpp_cli-upstream`，首轮运行可复核。

来源：[audio.cpp Seed-VC 文档](https://github.com/0xShug0/audio.cpp/blob/bd88e6eaa1d25a1ee1513e19e72e72a5de757187/docs/models/seed_vc.md)、[GGUF 固定快照](https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/a199f1a00ae893af0067caeab51f810de4c728a5/SeedVC-MLX-GGUF)、[公开测试素材](https://github.com/Plachtaa/seed-vc/tree/51383efd921027683c89e5348211d93ff12ac2a8/examples)。

## 6. 追加：沈腾参考音色

使用现有 `public/tts-presets/shenteng.wav`（约 7.11 秒）替换参考音，其余沿用 F16、Metal、30 步、seed 42、原调、分离人声及前后余量流程，无需训练。14 秒带余量转换总耗时 77.44 秒，物理内存峰值 2.39 GiB，Metal 分配观测峰值 3.33 GiB。裁取原曲 60–70 秒并处理边界后，交付 10.1 秒试听。

- [沈腾参考录音](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/shenteng.wav)
- [沈腾参考转换：带伴奏](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-shenteng-with-accompaniment.wav)
- [沈腾参考转换：单独人声](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-shenteng-vocals.wav)

两份最终 WAV 均已验证时长、格式、末尾归零及无触顶采样；具体音色相似度和清晰度待试听确认。复现命令：

```bash
cd /Users/liu_y/code/music
cp public/tts-presets/shenteng.wav test-results/seed-vc-trial/inputs/shenteng.wav
python3 test-results/seed-vc-trial/run_trial.py f16 metal user-vocals-context shenteng 30
python3 test-results/seed-vc-trial/mix_preview.py shenteng
```

### 6.1 试听反馈与人声音量调整

用户评价沈腾参考转换约 70 分，基本可接受，但回混人声偏小。追加人声相对伴奏 +3 dB 版本，复用已有转换结果，不重新推理；保留 20 ms 边界淡变和 100 ms 末尾静音。整体峰值保护可能同时衰减两轨，但人声与伴奏的相对增益提高 3 dB。已验证输出为 10.1 秒、无触顶采样、末尾归零。

[人声 +3 dB 试听](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-shenteng-vocal+3db-with-accompaniment.wav)

```bash
python3 test-results/seed-vc-trial/mix_preview.py shenteng 3
```

## 7. 追加：迪丽热巴参考音色

使用现有 `public/tts-presets/dilireba.wav`（7.63 秒，参考无触顶采样），沿用 F16、Metal、30 步、seed 42、原调、分离人声和前后余量。人声相对伴奏提高 3 dB；尚未测试女声音区移调。14 秒转换总耗时 86.45 秒，物理内存峰值 2.39 GiB，Metal 分配观测峰值 3.33 GiB。

- [带伴奏试听](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-dilireba-vocal+3db-with-accompaniment.wav)
- [单独人声](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/converted-context-dilireba-vocal+3db-vocals.wav)

已验证两份最终输出 10.1 秒、无触顶采样、末尾归零；音色相似度与清晰度待用户试听。

```bash
python3 test-results/seed-vc-trial/run_trial.py f16 metal user-vocals-context dilireba 30
python3 test-results/seed-vc-trial/mix_preview.py dilireba 3
```

## 8. 龚琳娜参考制作与全曲状态

用户提供 `/Users/liu_y/Downloads/龚琳娜.m4a`（232.17 秒，演唱、伴奏和混响）。先由 HTDemucs 分离人声，再用 `Reverb_HQ_By_FoxJoy.onnx` 的混响输出作减法；ONNX Runtime CPU 推理不依赖 PyTorch。去混响约 43.34 秒，`time -l` 记录物理峰值约 5.22 GiB，处理效果仍需试听，不能视为完全去除观众声的保证。

最初自动选出的 9 秒参考被用户指出过短，且混入掌声欢呼，因此已否定。旧参考对应的全曲任务已终止，旧分段不能进入新成品。新任务使用独立参考名和缓存目录，避免误用旧结果。

按最新要求，参考改为 30 秒：原录音 40–54 秒、66–81 秒的人声段，中间 1 秒静音，切口 15 ms 淡变。已验证时长、静音间隔及无触顶采样；用户试听认可中段参考，并要求将第二段后移10秒，已执行。当前 Seed-VC 原生实现只读取前 25 秒参考，因此实际使用 24 秒人声加 1 秒间隔，后 5 秒不参与此次推理。没有修改这个模型限制。

- [新的30秒参考](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/gonglinna-30s.wav)
- [实际前25秒范围](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/gonglinna-effective-25s.wav)
- [参考制作记录](/Users/liu_y/code/music/test-results/seed-vc-trial/gonglinna-reference-30s.json)

《爱在西元前》全曲已使用用户调整后的 `gonglinna-30s-v2.wav` 完成转换，否定的旧参考结果未复用。采用小于30秒的输入片段，带前后余量与重叠拼接，避免 Whisper 内容编码仅取前30秒而造成长音频内容丢失。参考素材的一秒间隔没有插入最终歌曲。

原 30 秒窗口版本的长参考性能诊断：4秒歌曲片段配合实际25秒参考，F16/30步总耗时90.98秒、物理峰值2.30 GiB。参考与歌曲共享约30秒上下文，长参考显著减少每次可转换的歌曲长度。该诊断使用后移第二段前的参考，仅用于性能观察，不作为最新音色的成品。

### TTS 同一音色参考验证

已将 15 秒龚琳娜参考保存到音色库，并用相同 SHA-256 的参考完成原生 IndexTTS2 F16 + Metal 试读：“你好，欢迎回来。今天的故事从这里开始。”输出 7.6278 秒、22.05 kHz 单声道 WAV，非静音且无削波。完整进程耗时 52.64 秒，原生报告物理内存峰值 4.25 GiB；其中 CLI 报告生成阶段 27.53 秒，与完整进程口径不同。未使用 PyTorch。

**2026-10-10 用户试听结论：TTS 声音带明显混响，不接受作为语音音色。** 这份演唱参考虽然已分离伴奏并做过去混响，仍未达到 TTS 使用标准。将龚琳娜参考限定为歌声音色转换用途，从 TTS 可选音色中移除，原参考、歌曲结果及失败试听保留用于追溯。

当前产品经验：从音乐或现场演唱中提取的人声只用于歌声转换，不进入 TTS。TTS 优先使用无伴奏、少混响、自然说话的录音；TTS 使用独立录制的自然说话参考。唱歌转换认可不等于 TTS 认可；无削波、长度正确及推理成功只证明技术链路，不证明听感合格。本次不将该经验外推成所有音乐参考绝对无法用于 TTS 的模型结论。

- [TTS 试听](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/gonglinna-tts-sample.wav)
- [TTS 参数与资源记录](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/gonglinna-tts-sample.json)

### 8.1 全曲交付验证

使用用户调整后的30秒参考（40–54秒、66–81秒，中间1秒静音；模型实际读取前25秒），完成《爱在西元前》全曲处理。输出长 238.28304 秒，与输入逐采样长度一致。共16个时间段，其中 13 段执行原生 SVC，近静音段不生成人声但保留伴奏。源段保留1.5秒上下文，相邻输出重叠0.5秒；参考中的一秒静音没有插入歌曲。

各段原生推理累计耗时 35.02 分钟；任务墙钟时间 85.64 分钟包含为了优先处理莫文蔚歌曲而暂停的等待，不应作为模型速度。SVC 物理内存峰值 2.42 GiB、Metal分配观测峰值 3.74 GiB，两者不能相加。各轮系统swap-out增量合计 0 页，不是进程独占统计。按原分离人声做分段RMS匹配并提高3dB，低能量人声区使用平滑衰减，最终等比例衰减避免新削波。未改变音调或唱法。第3–5段保留此前30秒生成窗口的成功结果，第6–15段用45秒生成窗口续跑，参考始终不变；第1、2、16段近静音跳过。窗口切换与二进制哈希记录在 `resume-context45.json`。本早期实验输出为单声道；新页面任务则保留原背景立体声。

两份全长WAV已验证格式、时长、末尾归零、无触顶采样；这不代表全曲听感已经验收。

- [全曲 WAV](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/ai-zai-xi-yuan-qian-gonglinna-full.wav)
- [全曲 M4A](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/ai-zai-xi-yuan-qian-gonglinna-full.m4a)
- [全曲转换人声](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/ai-zai-xi-yuan-qian-gonglinna-vocals.wav)
- [逐项验证记录](/Users/liu_y/code/music/test-results/seed-vc-trial/gonglinna-30s-v2-full/verification.json)

## 9. 莫文蔚完整歌曲与页面服务验收

用户提供 `忐白门.m4a`，解码后为 44.1 kHz、立体声、9,336,764 帧（211.718004535 秒）。使用已保存的龚琳娜 15 秒参考：去伴奏与去混响后的原录音 40–47 秒，加 1 秒静音，再接 74–81 秒；第二段为用户指定的后 7 秒高音。

真实服务任务 `conversion-4884577e-d5ac-44e4-a38e-833340a8395f` 完成 HTDemucs 分离、14 段 Seed-VC `v1_svc` 推理、原背景立体声回混。F16、Metal、30 步、seed 42、移调 0；DiT 总窗口 45 秒，外部分段最长 19 秒，仍低于 Whisper 内容编码 30 秒上限。参考的 1 秒空白只用于音色条件，不插入歌曲。

| 项目 | 实测 |
| --- | --- |
| 完整输出 | 211.718004535 秒，立体声 44.1 kHz / PCM16 |
| 服务全流程耗时 | 1429.583 秒（23.83 分钟） |
| 全流程 RTF | 6.752 |
| 原生物理内存峰值 | 2.413 GiB |
| Metal 分配观测峰值 | 3.578 GiB；不能与物理内存直接相加 |
| 系统 swap-out 增量 | 0 页；系统级观测，不是进程独占指标 |
| Seed-VC F16 模型文件 | 3,629,186,560 字节 |
| HTDemucs 模型文件 | 84,059,168 字节 |

验收通过：14 段完整成功，转换结果与输入逐采样等长；参考 SHA-256 与保存音色一致；无触顶采样、首尾淡出归零；所有重叠区域权重之和为 1。独立检查混音左右声道之差与分离背景左右声道之差，按最终增益与边缘淡出重构，最大误差 0.000030514，约一个 PCM 单位，确认背景立体声结构保留。信号检查不替代歌词清晰度、自然度或本人相似度的主观试听。

实际使用的源码 commit 为 `bd88e6eaa1d25a1ee1513e19e72e72a5de757187`，45 秒窗口二进制 SHA-256 为 `8d799aaf44ac2dc75db2a64e3444132b00e20d1dd3db8ba2a4144461000641ab`。精确安装信息、每次 CLI 参数与计时均保存在任务目录的 `metrics.json` 和 `native.log`；服务界面与安装说明见 [音色转换功能](voice-conversion.md)。

- [完整 WAV](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/mowenwei-gonglinna-full.wav)
- [完整 M4A](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/mowenwei-gonglinna-full.m4a)
- [转换后纯人声](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/mowenwei-gonglinna-vocals.wav)
- [完整原音](/Users/liu_y/code/music/test-results/seed-vc-trial/outputs/mowenwei-gonglinna-source.wav)
- [参考音色](/Users/liu_y/code/music/test-results/seed-vc-trial/inputs/gonglinna-tts-15s.wav)
- [独立验收 JSON](/Users/liu_y/code/music/test-results/seed-vc-trial/mowenwei-gonglinna-product-verification.json)

重复验收命令：

```bash
test-results/seed-vc-trial/onnx-env/bin/python \
  test-results/seed-vc-trial/verify_product_conversion.py \
  /Users/liu_y/Music/MusicRoom/conversion/conversion-4884577e-d5ac-44e4-a38e-833340a8395f
```
