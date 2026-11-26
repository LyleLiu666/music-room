# 测试与发布验收

本页是测试的统一入口。正式范围是 macOS Apple Silicon、本地服务、独立包、Chrome 界面及 HTTP / MCP。Chrome 必须通过，WebKit 做兼容检查；原生 Safari 的结果单独记录。验收不扩展到操作系统辅助功能专项，不开启或操控此类功能。

## 日常怎么跑

```sh
npm run verify:all
```

依次执行单元测试、构建、服务 / HTTP / MCP、歌词 Python、歌词实验规则和 Chrome 工作台 / 乐谱 / 歌词 / 资源测试。任一步失败即停止。重型真实模型、整机操作和长稳需要单独执行，不会由日常入口自动触发。

开发时先跑改动附近的测试；交付前完成日常回归。浏览器单独回归前先 `npm run build`，避免测到旧的 `dist/`。不要同时运行多个构建、独立包验证或真实模型套件。

## 按改动选择补充验收

以下是在日常回归之外需要补跑的范围，具体命令、环境和清理步骤见[执行指南](testing/running.md)。

| 改动 | 补充验收 | 关键用例 |
| --- | --- | --- |
| 草稿、表单、布局、播放器 | WebKit；影响缩放时补 200% 缩放，影响 Safari 时补原生 Safari | DRAFT、UI、UI-ZOOM |
| 保存、删除、重试、目录格式 | 强制退出恢复、网络丢响应、旧目录升级与完整备份恢复 | SAVE、DELETE、RETRY、UPGRADE、BACKUP |
| 模型、音频格式、转换、变速、歌词 | 对应真实引擎、固定语料和人工质量验收 | MEDIA、LYRICS、REAL、QUALITY |
| 资源策略、队列、缓存、长时间运行、数据规模 | 真实混合队列、独立包资源保护、至少 60 分钟长稳 | RESOURCE、SCALE、SOAK |
| 安装、磁盘写入、生命周期 | 受控满盘、服务及浏览器恢复；涉及系统行为时补相应系统场景 | REAL-03、REAL-04 |
| 发布独立包 | 构建后执行独立包验证；相关真实模型也使用该包验收 | REAL-02 |
| 独立 YuE2 试验台 | `npm run test:trials` | 试验台自身测试 |
| 测试入口、语料、证据校验、执行脚本 | `npm test` 与所改脚本的实际验证，包含应失败的输入 | 测试漏项、续跑和质量门禁回归 |

## 去哪里看

TTS 候选横向比较见[本机 TTS 模型选型](tts-model-selection.md)，模型试听见[2026-10-26 低内存试验](testing/verification-breeze-2026-10-26.md)，正式兼容规则及验收见[Breeze / IndexTTS 接入记录](testing/verification-breeze-integration-2026-10-26.md)。

| 文档 | 负责回答 |
| --- | --- |
| [用例与状态覆盖](testing/cases.md) | 需要验证什么，前置条件、操作和预期是什么，断言在哪里 |
| [执行指南](testing/running.md) | 命令怎么运行，怎样准备隔离环境、保存证据和清理 |
| [固定语料与听评](testing/quality.md) | 输入、种子、模型效果评分和歌词真值如何验收 |
| [维护规则](testing/maintenance.md) | 新增 / 修改 / 删除用例，处理失败与维护基线时遵循什么规则 |
| [2026-11-26 YuE2 时长容差与过期恢复点修复](testing/verification-duration-recovery-2026-11-26.md) | `±30%` 容差、偏差音频保留、自动时长恢复点兼容、侧栏缩放和日常服务验收 |
| [2026-11-26 集成发布](testing/verification-integrated-release-2026-11-26.md) | 内存、创作界面与时长处理的统一复核、安装包验证及日常部署 |
| [2026-11-26 内存启动规则](testing/verification-memory-admission-2026-11-26.md) | 警告压力下按预算启动、危险压力与运行保护、界面状态一致性 |
| [2026-11-25 即兴会话超时与租约重试](testing/verification-live-recovery-2026-11-25.md) | 悬挂响应、请求去重、租约释放重试及独立包验证 |
| [2026-11-25 翻唱与即兴故障恢复](testing/verification-entropy-fixes-2026-11-25.md) | 彻底删除、回留重试、停止确认及失败状态一致性 |
| [2026-11-24 翻唱与即兴交付](testing/verification-cover-live-release-2026-11-24.md) | 浏览器复验、本机样本、真实资源互斥、独立包结果 |
| [2026-11-24 ACE-Step 翻唱后端](testing/verification-ace-cover-backend-2026-11-24.md) | 真实模型安装、资源采样、选段与新版本保存 |
| [2026-11-24 同步歌词人工校对](testing/verification-lyrics-manual-review-2026-11-24.md) | 待定位句、歌词时间轴、保存冲突及浏览器验证 |
| [2026-11-24 全休止人声轨生成](testing/verification-vocal-abc-omission-2026-11-24.md) | 真实试听样本、伴奏与歌词输入检查、回归与安装结果 |
| [2026-11-08 项目音效工作流](testing/verification-effect-workflow-2026-11-08.md) | 项目内音效版本、独立录音加入项目、平滑截取与本轮未完成验收 |
| [2026-11-08 音效接入与复验](testing/verification-sound-effects-integration-2026-11-08.md) | 固定模型、MCP 与声音库、内存保护、取消、备份和已知待验收项 |
| [2026-11-07 语音工作区 UX](testing/verification-voicestudio-ux-2026-11-07.md) | 正文/参考音色双栏、TXT 导入、草稿恢复与浏览器回归 |
| [2026-10-29 目标时长重规划反馈](testing/verification-duration-feedback-2026-10-29.md) | 实测谱长偏差反馈、上下文预算保护、规则回归与真实模型内存压力阻塞 |
| [2026-10-29 审查修复与本机安装](testing/verification-review-fixes-2026-10-29.md) | 备份异常中断、恢复完成协议、只读文件、音频请求归属与发布安装 |
| [2026-10-29 首次创作、备份与读取成本](testing/verification-ux-performance-2026-10-29.md) | 快速创作、停服备份恢复、刷新降频、音频缓存与产物区间读取 |
| [2026-10-26 AI 编曲与 MCP 指南](testing/verification-music-agent-2026-10-26.md) | 创作入口、乐器轮换与 riff 变奏指南、MCP 发现与独立包验证 |
| [2026-10-26 目标时长修复](testing/verification-duration-2026-10-26.md) | 短谱误接受复现、乐谱与最终音频检查、专项验证及本机更新 |
| [2026-10-23 执行记录](testing/verification-2026-10-23.md) | 这一次实际通过、失败或未完成了什么 |
| [2026-10-23 原提示词规划回归](testing/verification-planning-2026-10-23.md) | 连续三次规划失败的原样复现、修复与后续发布依据 |
| [2026-10-24 侧栏布局回归](testing/verification-sidebar-2026-10-24.md) | 项目搜索与新建合并、小窗口自适应分页及浏览器验收 |
| [2026-10-24 声音库与播放列表](testing/verification-library-2026-10-24.md) | 服务端分页、持续播放、列表保存、独立包专项与本机更新；完整包验收的内存压力阻塞 |
| [2026-10-24 声音库布局](testing/verification-library-density-2026-10-24.md) | 顶部两排工具栏、紧凑列表、首屏容量、窄窗口与缩放回归 |
| [2026-10-24 随机播放](testing/verification-library-shuffle-2026-10-24.md) | 跨页乱序、播放历史、刷新恢复、队列编辑与本机预览更新 |
| [2026-10-24 歌词双服务](testing/verification-lyrics-openai-2026-10-24.md) | Cloudflare 优先、额度不足转魔搭、真实接口样本与接入限制 |

命令以 `package.json` 为准，行为以可执行断言为准。用例索引不复制通过数量；带日期的记录只描述当次执行，不能作为后来版本的通过证明。

## 发布判断

1. 功能修改先增加能证明问题的失败用例，再修复并回归；日常入口必须通过。
2. 补充验收按上表选择，记录所测代码、命令、环境、退出码和产物。没有执行记录就是未验收。
3. P0 / P1 未解决、原音频变化、数据丢失、错误显示成功，均阻止发布。
4. 真实引擎成功、文件可播放与人工听评达标分别记录；测试替身不能证明模型效果。模型 / 质量变更缺少听评时，质量验收仍未完成。
5. 未运行、环境阻塞、失败、通过分别记录。重跑保留首次失败；WebKit 和原生 Safari 不混入 Chrome 通过数。

运行证据保存在忽略目录 `test-results/`；仓库保存用例、可复现脚本、维护规则和简明执行结论。不要提交模型、凭据、用户项目或大体积测试产物。
