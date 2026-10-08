# YuE2 本机生成

## 用户操作

启动普通 `music-room` 二进制后，在网页左侧点击 **AI 音乐 · YuE2**。

1. 点击 **启用 YuE2**，选择专用空文件夹，也可以直接填写绝对路径。
2. 保持 **下载生成模型与纯器乐适配器** 勾选，点击 **安装并启动**。首次准备需要网络；页面显示阶段、写入量和日志。失败后可在同一目录重试。
3. 状态显示 **模型就绪** 后，填写音乐描述，点击 **生成音乐**。默认纯器乐、快速试听；完成后可试听或下载 FLAC。

用户无需安装 Python、Git、Homebrew 或输入安装命令。当前自动安装支持 Apple Silicon Mac，使用专用 Python 3.12、MLX 和 YuE2 Studio。上游要求至少 16 GB 内存及支持该芯片的 macOS；生成时间取决于硬件、曲长和质量设置。

YuE2 下载约 10 GB 基础权重，另有器乐适配器、Python、依赖、源码及缓存。安装与模型不会嵌入工作台二进制，也不加入 Git。模型许可是 **CC BY-NC 4.0**，YuE2 Studio 代码是 MIT；免费使用的范围与模型许可保持一致。

## 一个目录保存全部引擎文件

默认目录是 `~/Music/YuE2`，可由用户更改。首次安装只接受空文件夹；再次安装只接受已标记为工作台管理的 YuE2 目录，避免覆盖无关文件。

| 子目录 | 内容 |
| --- | --- |
| `bin/`、`python/`、`.venv/` | 专用 uv、Python 和依赖 |
| `source/`、`downloads/`、`requirements.txt` | 固定版本源码、校验过的安装文件及依赖清单 |
| `models/` | 基础模型、VAE、器乐适配器及下载续传文件 |
| `cache/`、`tmp/`、`config/`、`state/` | 包缓存、模型缓存、临时文件及运行设置 |
| `data/` | YuE2 数据库与生成音频 |

Music Room 的作品工作目录只保存指向这个引擎目录的设置 `engines/yue2.json`。基础 MIDI/JSON 作品仍保存在原来的项目目录。安装流程不改全局 Python，不将已有模型复制到每个项目。

安装成功后启用自动启动；关闭整个工作台会停止其所属 YuE2 进程，下次启动自动恢复。网页 **停止** 按钮会取消下载或停止引擎，并关闭自动启动。已有安装与模型保留。更换目录前先停止引擎；关闭工作台后可删除整个专用目录回收空间。

下载可重试，模型续传由 Hugging Face 下载工具处理。运行环境使用固定版本 uv、YuE2 Studio、mlx-Yue，下载归档检查 SHA-256，Python 运行依赖检查锁定哈希；安装器不会运行远程 shell 脚本。

## Agent 的 MCP 接口

复用 Music Room 自带的同一 MCP 配置，无需另配 YuE2 MCP。

| 目的 | 工具 |
| --- | --- |
| 查看目录、日志及模型状态 | `yue2_status` |
| 让用户选择文件夹 | `yue2_choose_directory` |
| 准备与后台启动 | `prepare_yue2(directory, downloadModels)` |
| 启动 / 停止 | `start_yue2`、`stop_yue2` |
| 提交生成 | `yue2_generate(style, lyrics?, preset?, instrumental?, seed?, title?)` |
| 查询 / 取消 | `yue2_get_job(jobId)`、`yue2_list_jobs`、`yue2_cancel_job(jobId)` |

`prepare_yue2` 立即返回，随后轮询 `yue2_status`，只有 `canGenerate=true` 才提交生成。首次模型下载应遵循用户明确选择的目录和下载意愿。

`yue2_generate` 默认 `instrumental=true`、`preset=fast`、`lyrics="[instrumental]"`、`cot=full`，自动组合 AR 器乐 LoRA 与 NAR 音频 LoRA。`lyrics` 也可以写明确的段落结构；使用器乐适配器时按上游建议使用未标注时间的段落标签。生成曲长由模型规划，不能保证描述中的时长精确兑现。

返回 `job.id` 是 32 位十六进制。用 `yue2_get_job` 查询到 `job.status=done` 后，`audioPath` 指向所选目录内的 FLAC；`failed` 会包含失败原因。网页关闭后后台仍生成，重新打开可查看最近任务。完整上游项目、变体等功能可以通过 **打开 YuE2 Studio** 使用。

示例提示词：

> 使用 Music Room MCP，先检查 YuE2 是否就绪。生成一段纯器乐，钢琴主导，有清晰的两小节 riff、切分鼓点和温暖贝斯；主题要有回答与留白，副歌展开，避免机械重复。先用 fast 试听，查询到完成再给我音频路径，不要把排队当作生成成功。

YuE2 输出是音频作品，当前不会自动转成 MIDI，也不会自动成为 MIDI/JSON 乐谱项目中的一个版本。原有 `render_revision/get_job` 是乐谱采样渲染；YuE2 使用独立工具和任务状态。

## 生命周期与验证边界

后端管理一个所属 YuE2 引擎，目录锁防止不同工作台同时使用相同安装。专用工作进程通过标准输入保持父进程租约；工作台取消、退出或租约丢失时停止整个所属计算进程组。不会停止用户自己启动的其他服务。

YuE2 使用随机本机端口，限制 Host/Origin，并在健康检查中核对本次启动的身份及真实引擎状态。主工作台 API/MCP 和音频下载继续采用本机访问令牌。可选引擎设置损坏或硬件不支持不会阻止其他作品功能启动。

开发分三轮，每轮经过测试、实现、代码审查、修复与提交：

1. 专用目录、安装、状态、进程归属、停止及重启边界。
2. 同一后台能力接入网页与 MCP，完成普通用户操作及接口回归。
3. **真实下载、真实 MLX 生成、音频验证**，再完成独立二进制验证、文档、push 和重启。测试替身只证明边界逻辑，不能代替第三轮推理验收。
