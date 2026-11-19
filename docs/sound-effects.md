# 本机音效生成

在项目内选择「新声音 → 音效」，填写声音描述和 1–5 秒时长，默认 3 秒。生成结果成为该声音的新版本，可继续修改描述生成其他版本、试听比较、标记成品。首次使用先点击「准备音效模型」；模型文件约 1.7 GB，另需程序、Python 环境和安装空间。生成时可以关闭窗口继续其他工作。

也可从「声音库 → 生成音效」直接制作独立音效，稍后在声音库选中它并选择「加入项目」。原独立录音及已有播放列表会保留。项目音效和独立音效均可在声音库按「音效生成」筛选、试听、下载和加入播放列表；外部导入的声音保持原来的来源标记。

对于不超过 30 秒的录音，可选「截取音频」，设置起止时间和淡入、淡出（默认各 30 毫秒）。截取结果另存为 WAV；项目内生成子版本，独立录音生成新条目，原音保留。淡入与淡出的总时长不能超过截取长度。

模型为固定版本 Stable Audio 3 Small-SFX / MLX，使用英文描述通常更稳定；生成的声音、开头和结尾是否合适，以试听为准，不保证精确模仿指定设备。当前首版只开放 1–5 秒，方便作为独立片段使用。

## MCP

1. `sound_effect_status` 查看是否已安装，以及最近任务。
2. 未安装时调用 `sound_effect_prepare`，轮询状态；如需停止使用 `sound_effect_cancel_preparation`。准备会下载固定程序、依赖和权重，可在失败后明确重试。
3. 项目内先用 `studio_create_sound` 创建 `kind: effect` 的声音，再将它的 `soundId` 传给 `sound_effect_generate`；还可传该声音已有版本的 `parentId` 继续创作。不传 `soundId` 则生成独立录音。
4. `sound_effect_generate` 接收 `requestId`、`title`、`prompt`、`seconds` 和可选 `seed`；立即返回任务。相同 `requestId` 和相同输入返回同一任务，输入不同则拒绝。未指定种子时自动生成并保存。
5. 用 `sound_effect_job` 查询任务；`succeeded` 的 `item.audioPath` 是需本机令牌的 WAV 地址，`item.source` 保存描述、时长、模型和种子。可用 `sound_effect_cancel` 取消排队或运行中的任务；已保存的音频保留。程序重启时未完成任务标记中断，不自动重跑。
6. 使用 `studio_trim_audio` 截取项目音效版本，或用 `sound_library_trim` 截取独立录音；时间以秒为单位，淡入淡出以毫秒为单位。两者均需唯一 `requestId` 并保留原音。独立录音可用 `studio_attach_sound` 加入项目。

模型安装在 `~/Music/MusicRoom-SoundEffects/`，由本机各工作区共享；生成记录和声音库随各自工作目录保存。备份工作目录会保留记录和音频，不包含可重新准备的模型环境。生成使用项目共享队列，按固定模型和短片段输入申请 5 GB 内存；运行中监测所属进程组及模型进程生命周期峰值。超限或无法可靠监测时停止，不降低精度或自动重试。采样不是瞬时硬上限；系统压力偏高时任务可能等待或失败，见[本机模型与资源](model-resources.md)。

本机程序与权重需从固定上游下载并校验；使用模型时遵守 [Stability AI 许可](https://stability.ai/license)。真实运行和听评范围见[音效验收记录](testing/verification-sound-effects-integration-2026-11-08.md)。
