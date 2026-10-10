# 本地音色转换

页面入口是创作空间侧栏的「音色转换」。上传整段音频、选择音色库中的参考，后台依次提取人声、转换音色、混回原背景音。原文件、参考快照和结果保存在工作目录的 `conversion/`，关闭网页不影响任务；停止本地服务会中断任务，之后可重试。

## 使用范围

- 适合单人演唱或说话。保留原内容、旋律、节奏和演唱方式，不会自动变成目标人物的唱法。
- WAV、MP3、M4A、FLAC、AIFF；上传不超过 200 MiB，解码后不超过 20 分钟。
- 目标参考复用现有音色库，支持仅用于音色转换的参考；此类参考不会出现在 TTS 可选音色中。无需逐音色训练；清理中的音色不能使用。
- 提供原音、完整混音结果和转换人声的试听与下载。参考音色变化不影响已保存任务。
- 分离模型可能留下人声或背景残响，音色相似度需要试听判断。处理速度仍取决于片段长度、参考长度及本机性能。

## 本机引擎

当前实现使用 audio.cpp、HTDemucs F16、Seed-VC F16 `v1_svc` 和 Apple Metal。音频解码使用 macOS `afconvert`；推理与混音不依赖 Python 或 PyTorch。每段保留上下文和 0.5 秒交叉淡化，背景保留原声道，输出逐采样长度必须与解码后的输入一致。

安装目录：`<workspace>/engines/voice-conversion/`。模型独立于网页和应用二进制，启动推理时验证固定哈希。安装命令：

```sh
node scripts/install-conversion-engine.mjs \
  --workspace "$HOME/Music/MusicRoom" \
  --binary /absolute/path/to/audiocpp_cli \
  --seed-model /absolute/path/to/seed-vc-mlx-f16.gguf \
  --separator-model /absolute/path/to/htdemucs-f16.gguf \
  --commit bd88e6eaa1d25a1ee1513e19e72e72a5de757187
```

源码、模型来源及编译命令见 [本机验证报告](audio-cpp-svc-test-2026-10-09.md)。当前本机已安装 **45 秒生成窗口**版本，参考读取上限仍单独限制为 25 秒；页面复用的 TTS 参考不超过 15 秒。Whisper 的单段输入限制没有修改，外部分段含上下文最多 19 秒。

在固定源码提交上、编译之前应用：

```sh
git -C /absolute/path/to/audio.cpp apply /absolute/path/to/music/native/seed-vc/context45.patch
git -C /absolute/path/to/audio.cpp apply /absolute/path/to/music/native/seed-vc/metal-memory-logging.patch
```

后一个补丁仅增加 Metal 分配观测日志。当前已安装 CLI SHA256：`8d799aaf44ac2dc75db2a64e3444132b00e20d1dd3db8ba2a4144461000641ab`。

同一段 17.5 秒输入、同一份有效 25 秒参考、F16 Metal 30 步的窗口对照：30 秒窗口耗时 262.82 秒，45 秒窗口耗时 162.24 秒，减少约 38%。45 秒版物理内存峰值 2.42 GiB、Metal 分配观测峰值 3.70 GiB；两者不能相加。这是短段对照。整曲实测：211.718 秒立体声歌曲、15 秒参考、30 步，分离到混音共 1429.58 秒（23 分 50 秒），RTF 6.75；原生物理内存峰值 2.413 GiB，Metal 分配观测峰值 3.578 GiB，系统 swap-out 增量 0 页。14 段全部完成，输出与原音逐采样等长、无削波，真实页面播放与下载校验通过。此速度适合离线等待，尚不适合即时转换；自然度与相似度仍需试听判断。

## 运行与验证

```sh
npm run build
npm run serve -- --workspace "$HOME/Music/MusicRoom"
node --test src/service/conversion/*.test.ts src/server/conversion.test.ts
node --test scripts/verify-conversion-ui.test.mjs
```

页面请求与音频文件均需要本地访问令牌。重复上传使用同一请求标识时不会重复创建任务；失败、取消、中断均可另建重试任务。任务运行时保存分阶段进度、原生命令日志和混音指标；输出缺失或长度异常不会发布成功结果。

每次只运行一个音色转换任务。已有 TTS、参考清理或环境准备任务会先完成；转换排队或运行期间，新的语音生成、参考清理和环境准备请求会提示先等待或取消转换。子进程支持取消和超时保护；macOS 物理内存观测超过 10 GiB 时停止。物理内存与 Metal 分配是不同观测口径，不相加；完整性能和音质结论以真实模型验收为准。

## 当前验收结论与参考用途

2026-10-10：本机离线转换链路作为当前稳定基线保留，已完成真实整曲、页面播放下载、任务取消与恢复及自动测试验证。稳定范围为已验证的 Apple Silicon 本机配置；不表示实时处理、任意录音质量或所有音色相似度已获保证。

龚琳娜演唱参考用于歌曲转换的效果获得用户认可，但 TTS 试读混响明显，已判为不合格并限制为转换用途。当前产品规则是不把从歌曲中分离的人声用于 TTS；普通语音参考应使用干净的自然说话录音。两种用途分别验收，不能用能生成或波形检查通过代替听感判断。
