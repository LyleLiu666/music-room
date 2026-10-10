# IndexTTS 2.0 语音创作

当前资源规则见[本机模型与资源](model-resources.md)：原生正文最多 140 字、生成结束卸载；网页参考上传先验证有界 PCM WAV，再取最多 15 秒。压缩音频或视频请先导出 WAV 片段。


## 在页面生成语音

启动本地程序，从首页选择项目，点「新声音 → 语音」。语音与音乐使用同一个创作空间，旧 `/speech.html` 地址也打开统一页面。静态开发网页没有语音后台，需要 `npm run build` 后运行 `npm run serve`，或者使用独立二进制。

1. 创建项目，添加一个语音，例如「片头旁白」。一个项目可以收纳多个语音。
2. 首次点「准备语音模型」。Apple Silicon 后台自动准备固定版本的 audio.cpp 程序和 IndexTTS 2.0 F16 模型；完成后显示「已就绪」。后续启动复用已安装环境。
3. 选择参考声音，填写要说的文字。可填写情绪描述，例如「平静、温暖」，并选择「情绪非常平淡 / 情绪平淡 / 情绪一般 / 情绪强烈 / 情绪非常强烈」，新创作默认一般（沿用首轮试听的平淡强度）。描述指定情绪类型，强度调节表现程度；描述留空时也能调节参考人声的情绪影响。
4. 点「生成新版本」，完成后直接试听、下载 WAV，或选作项目成品。

## 参考人声与音色库

可上传 50 MiB、10 分钟以内的单/双声道未压缩 PCM WAV；页面在解码前检查文件头。指定片段起始位置，取最多 15 秒。选择只有一个人说话或唱歌的片段，避开前奏、多人合唱和严重失真。

默认勾选「自动清理人声」：后台依次提取人声、降噪、减弱回声与混响，最后去掉首尾静音，整理为 22.05 kHz 单声道 PCM WAV。已干净的素材可取消勾选，直接保存原音。其他音频或视频需先导出有界 WAV 人声片段。

上传后可以关闭创作窗口，后台继续清理；处理中或失败的音色不能用于生成，失败和中断可以重试。页面保留原音与处理后人声的对照试听。分离可能改变音色或留下残余配乐，是否满意以实际试听为准。

音色保存到当前工作目录的共享音色库，所有项目都能复用，重启服务后仍保留。内置五个干人声音色：迪丽热巴、天津团团记、女网红、官方样音和沈腾。内置音色先排列，可「设为常用」，新声音优先选择常用音色。audio.cpp 在单次任务内使用参考特征；当前任务完成后进程退出，不跨任务常驻缓存。原音文件仍可试听。安装包中的原版 NPZ 特征保留供旧 Python 路径使用，audio.cpp 不读取这些 NPZ。已有音色点击「清理这个音色」会另存清理版，不改变历史版本使用的参考文件。

每次生成保留独立版本。提交后继续输入的是下一版草稿，不改变正在生成的要求。「修改这版」恢复原文字、音色、情绪描述与强度并记录来源；「保留灵感」与「选作成品」分别管理。勾选可批量删除，两版音频可比较试听，一次只播放一个。项目、片段、版本和音色均可删除到统一回收站，支持恢复与确认后彻底删除；运行中的内容需要先取消或等待完成。版本列表保留生成时的音色名称，音色改名或删除不改变已有音频。

关闭页面不停止后台任务。停止本地服务会中断任务；重新启动保留已完成音频和要求，可以再次生成。

## 环境与文件

默认安装目录为 `~/Music/IndexTTS2`，可以在「环境与模型 → 安装位置与日志」选择其他空目录。Apple Silicon 默认使用 **audio.cpp 0.9.1、Metal、IndexTTS 2.0 F16 GGUF**。程序和模型位于该目录的 `audio-cpp/`，模型文件约 4.65 GB；程序包、模型版本及 SHA-256 固定，多 GB 下载直接写入磁盘，支持中断续传。下载完成且校验通过后才报告就绪。

语音、音乐、转换和辅助处理共用同一有界队列。当前任务通过资源检查后才启动计算进程，完成后确认退出，再让下一项任务加载。关闭网页不停止已提交的任务；服务退出会停止所属任务。

取消排队任务不影响当前计算。取消运行中的任务等待所属进程退出，保留参考与生成要求；重试重新检查资源。人声清理同样取得执行权后才开始，不与推理并行。

程序发布包来自 [audio.cpp v0.9.1](https://github.com/0xShug0/audio.cpp/releases/tag/v0.9.1)，F16 模型固定到 `audio-cpp/audio.cpp-gguf` 快照 `a199f1a00ae893af0067caeab51f810de4c728a5`。现有 Python 环境和模型保留。旧 Python 驱动保留用于历史兼容，但没有当前资源需求档案；选择该驱动的新推理会被拒绝。其他平台未完成模型适配，不自动回退。

普通 TTS 推理不启动 Python。人声清理仍按需使用独立 Python 环境。当前资源实测见[固定引擎档案](design/model-resource-evidence.json)，原生迁移时期的连续推理与回退记录见 [原生引擎历史验收](tts-native-engine.md)；旧路径的历史诊断见 [PyTorch 内存诊断](tts-memory.md)。

人声清理由**同一个 Music Room 后台**排队和管理，清理工具按需运行。后台统一排队，按需启动受后台生命周期管理的计算进程，完成后退出；停止服务会终止所属进程，并保留原音供重试。

清理使用 `audio-separator 0.30.2` 和三个 UVR 模型：`UVR-MDX-NET-Voc_FT.onnx`、`UVR-DeNoise-Lite.pth`、`UVR-DeEcho-DeReverb.pth`。模型参数和 SHA-256 一起固定，加载前校验。首次清理在语音安装目录的 `reference-cleanup/` 内自动准备专用 Python 环境、FFmpeg 和模型，后续复用；依赖与 IndexTTS 环境隔离，参考素材只在本机处理。该运行组合已在 Apple Silicon 验证，其他平台待验证。各组件沿用上游许可，不将原音上传给模型下载网站。

工作目录中的语音数据：

| 文件 | 内容 |
| --- | --- |
| `speech/library.json` | 项目关联、声音、版本、参考标识、生成要求、成品和删除状态 |
| `speech/voices/<声音 ID>.wav` | 已保存参考音频，读取时核对哈希 |
| `speech/voices/<声音 ID>.original.wav` | 清理前原音，独立记录哈希，供对照试听和重试 |
| `speech/audio/<版本 ID>.wav` | 已完成的语音音频，记录长度、采样率和哈希 |

备份时停止服务并复制整个工作目录。清理浏览器不会删除音频和版本；尚未提交的草稿保存在本浏览器。IndexTTS 2.0 没有在页面提供精确时长或语速控制，不接收 MIDI 生成普通语音。

## Agent 工具与验证

内置 MCP 提供与页面相同的能力：`tts_status`、`tts_prepare`、`tts_cancel_preparation`、`tts_library`、`tts_add_voice`、`tts_clean_voice`、`tts_update_voice`、`tts_create_sound`、`tts_generate`、`tts_get_version`、`tts_cancel`、`tts_update_version`。先创建项目和声音，再选择参考音频生成；参考 WAV 可用 `tts_add_voice` 的 Base64 输入，默认后台清理，已干净素材可指定 `cleanup=false`。轮询 `tts_library.voices[].processing`，只有 `succeeded` 的清理结果可以用于生成。`tts_update_voice` 可改名、设置 `favorite` 或 `deleted`；统一层级删除与永久删除使用 `studio_update_project`、`studio_update_sound`、`studio_update_version` 与 `studio_purge`。`tts_generate` / `studio_generate` 可传 `emotionStrength=minimal|subtle|flat|normal|strong`；历史缺字段仍采用有描述 0.6、无描述 1 的原规则，不补造旧设置。音频位于工作目录，HTTP 下载需要本地服务令牌；原音使用 `/speech/voice-audio/<声音 ID>?original=true`。

`npm run test:service` 验证存储、取消、文件校验及后台进程管理。`npm run verify:speech` 通过正式网页和服务验证交互，使用测试驱动，不验证模型效果。准备真实模型后运行以下命令，通过正式浏览器提交中文文字和情绪、验证实际 WAV、播放、下载和刷新恢复：

```sh
MUSIC_ROOM_TTS_REAL=1 MUSIC_ROOM_WORKSPACE="$HOME/Music/MusicRoom" npm run verify:tts:real
```

真实验收在项目「语音创作」留下生成结果，报告与截图保存在 `test-results/speech-real/`。

人声清理的真实验收使用官方样音混合人工配乐、底噪和反射声，通过正式后台跑完整清理链，并验证原音保留、有效音频发布和对目标人声的信号改善。它不能代表所有歌曲和说话人的清理效果：

```sh
MUSIC_ROOM_REFERENCE_REAL=1 node scripts/verify-reference-real.mjs
```

音频与指标保存在 `test-results/reference-real/`，使用临时工作目录，不写入用户的项目或音色库。

预编码资产由 `scripts/encode-tts-presets.py` 在受管理的固定 IndexTTS 2.0 环境中生成。重新编码会覆盖 NPZ，打印新哈希；发布时同步更新 `preset-manifest.ts` 并重跑资产、真实推理与打包验证。原音、模型权重、源代码提交固定，不能复用另一版本的特征。内存结果与实际硬件验证边界见 [内存诊断](tts-memory.md)。
