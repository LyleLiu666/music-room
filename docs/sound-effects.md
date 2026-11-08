# 本机音效生成

在「声音库 → 生成音效」填写名称、声音描述和 1–5 秒时长。首次使用点击「准备音效模型」；模型文件约 1.7 GB，另需程序、Python 环境和安装空间。准备完成后按「生成音效」，可关闭窗口继续其他工作；完成后可在声音库按「音效生成」筛选、试听、下载 WAV 或加入播放列表。音效与外部录音分别标记，保留输入描述和种子。

模型为固定版本 Stable Audio 3 Small-SFX / MLX，使用英文描述通常更稳定；生成的声音、开头和结尾是否合适，以试听为准，不保证精确模仿指定设备。当前首版只开放 1–5 秒，方便作为独立片段使用。

## MCP

1. `sound_effect_status` 查看是否已安装，以及最近任务。
2. 未安装时调用 `sound_effect_prepare`，轮询状态；如需停止使用 `sound_effect_cancel_preparation`。准备会下载固定程序、依赖和权重，可在失败后明确重试。
3. `sound_effect_generate` 接收 `requestId`、`title`、`prompt`、`seconds` 和可选 `seed`；立即返回任务。相同 `requestId` 和相同输入返回同一任务，输入不同则拒绝。未指定种子时自动生成并保存。
4. 用 `sound_effect_job` 查询任务；`succeeded` 的 `item.audioPath` 是需本机令牌的 WAV 地址，`item.source` 保存描述、时长、模型和种子。可用 `sound_effect_cancel` 取消排队或运行中的任务；已保存的音频保留。程序重启时未完成任务标记中断，不自动重跑。

模型安装在 `~/Music/MusicRoom-SoundEffects/`，由本机各工作区共享；生成记录和声音库随各自工作目录保存。备份工作目录会保留记录和音频，不包含可重新准备的模型环境。生成使用项目共享队列，按固定模型和短片段输入申请 5 GB 内存；运行中监测所属进程组及模型进程生命周期峰值。超限或无法可靠监测时停止，不降低精度或自动重试。采样不是瞬时硬上限；系统压力偏高时任务可能等待或失败，见[本机模型与资源](model-resources.md)。

本机程序与权重需从固定上游下载并校验；使用模型时遵守 [Stability AI 许可](https://stability.ai/license)。真实运行和听评范围见[音效验收记录](testing/verification-sound-effects-integration-2026-11-08.md)。
