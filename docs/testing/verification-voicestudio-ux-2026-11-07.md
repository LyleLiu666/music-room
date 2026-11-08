# 2026-11-07 语音工作区 UX

## 范围与依据

参考 VoiceStudio 官方 README 与语音克隆工作区截图的操作组织：正文编辑为中心、参考音色随手试听、生成动作固定在底部。仅借鉴交互布局，自行实现，不复制其 AGPL 代码或素材。

- https://github.com/debpalash/VoiceStudio
- https://github.com/debpalash/VoiceStudio/blob/main/docs/media/electron/voice-cloning.png

Music Room 保留原项目、声音、草稿、版本与后台队列。语音创作窗口扩为双栏，窄屏改为单栏；TXT 导入追加而不覆盖，提供 8000 字容量校验及失败提示；生成按钮说明缺少音色或正文。模型接口、推理、音频处理、音乐创作与音色转换未修改。仓库原有 YuE2 与测试文档未提交修改保留。

## 执行记录

证据目录：`test-results/voicestudio-ux-2026-11-07/`。

- `npm test`：115/115 通过。
- `npm run build`：通过 TypeScript 和 Vite 构建。
- 语音情绪、Breeze 参考文字稿浏览器回归：2/2 通过（Chrome）。
- 新手/语音工作区浏览器回归：1/1 通过，涵盖 TXT 追加、超限保护、关闭刷新恢复、桌面双栏、390px 无横向溢出。已人工查看生成截图。
- 首次沙箱内 Chrome 启动 SIGABRT，未到业务断言；经授权在沙箱外执行恢复。首次新用例将 12 字误写为 13 字，已修正用例并复验，首次日志保留。
- 完整日常回归与 WebKit 结果见下文。未执行真实模型推理或人工听评，本次不涉及引擎变更，不将测试替身等同于真实效果。

## 完整回归结果

- `npm run verify:all`：实际执行至 Chrome 工作台，退出码 1。此前单测 115/115、服务/HTTP/MCP 401/401、歌词 Python 12/12、实验 Python 14/14、实验 TypeScript 8/8 均通过，构建通过。
- Chrome 工作台 68 项中 67 项通过，唯一失败为原语音布局用例固定断言正文 `rows=2`。本次明确改为大正文编辑区，因此将预期更新为 `rows=14`，保留参考音色双播放器高度、上传区紧凑、桌面/手机生成按钮可达性等全部断言，未放宽性能或资源保护阈值。
- 修改预期后完整复验 `scripts/verify-studio-conversion-ui.test.mjs`：3/3 通过（`compose-reference-final.log`）。没有再完整重跑一次 `verify:all`，因此不称为单次全量绿灯。
- 补跑剩余 `verify:score`、`verify:lyrics`、`verify:resources`：各 1/1 通过，退出码均为 0。
- `npm run verify:webkit`：9/9 通过（`webkit.log`）。
- 最终测试发现检查 `npm test`：115/115 通过。`git diff --check` 通过。

本轮仅完成语音创作这一条最直接的操作流，不声称已经复刻 VoiceStudio 的视频配音、听写、跨语言或批量故事工作台。未发布、未提交、未重装用户现有独立 App；源码与构建产物已更新。

## 第二轮：把入口接成完整创作路径

进一步核对官方 Gallery、Playback、Batch 与 Workflows 文档：

- https://github.com/debpalash/VoiceStudio/blob/main/docs/electron-gallery.md
- https://github.com/debpalash/VoiceStudio/blob/main/docs/electron-playback.md
- https://github.com/debpalash/VoiceStudio/blob/main/docs/electron-batch.md
- https://github.com/debpalash/VoiceStudio/blob/main/docs/electron-workflows.md

Gallery 文档明确标注部分迁移历史，只采用当前仍可核验的交互方向，不将其中历史实现描述当成新能力承诺。

对照后的差距与实现：

1. **找声音 → 试听 → 使用**：原来只有名称搜索，且必须先进入一个语音才能使用。现在支持全部/常用/可用筛选及卡片直接试听，从任何可用音色新建旁白，可选现有项目或创建第一个项目。确认填写正文前不生成，取消表单不会新建内容。后台创建晚返回时不重新打开已经关闭的编辑器。
2. **编辑 → 生成**：沿用第一轮大正文工作区、参考音色试听、TXT 导入和缺项提示。复用音色新建声音不覆盖原声音草稿。
3. **历史 → 试听 → 再创作**：任务历史增加直接试听与复用参数。只对可播放记录显示试听，只对保存了输入的语音/音乐版本显示复用；载入前明确告知会替换当前未提交草稿，可取消。载入后仍需用户确认生成，不直接重跑。
4. **后台进度 → 结果处理**：现有全局队列已支持真实阶段、排队、取消、失败原因、恢复与完成版本定位，因此沿用并通过全量回归保护，不另造百分比或重复队列。生成结果继续沿用试听、版本比较、成品选择与下载。
5. **超出既有能力的功能**：视频配音、多语言转写、流程画布、批量故事不由当前 API 提供，未增加假入口，未修改推理引擎。

第二轮证据目录：`test-results/voicestudio-flow-2026-11-07/`。单测当前 117/117、构建及音色端到端专项已通过；最终全量与 WebKit 结果见下文。

### 第二轮最终验证

- 构建 / TypeScript：通过。单测最终 117/117，服务/HTTP/MCP 401/401，歌词 Python 12/12，实验 Python 14/14，实验 TS 8/8 通过。
- 再次完整执行 `verify:all`，Chrome 工作台 68 项里 67 项通过，包括本轮扩展的完整音色创建/试听/历史复用/延迟关闭流程；唯一失败是旧测试用音色名称正则查找按钮，现在同时命中了「详情」和新增「试听」。将定位限定为 `data-action="select-voice"`，不改业务预期，单独复验五个内置音色的完整播放/切换主题/刷新身份流程，1/1 通过。该次 aggregate 退出码仍为 1，未伪称单次全量绿灯。
- 补跑剩余乐谱、歌词、资源阶段，各 1/1 通过、退出码 0。WebKit 9/9 通过。
- 本轮全部用例均得到通过结果，但分为全量执行和失败定位器修复后复验；未在定位器修复后再完整执行一遍 aggregate。首次失败和复验日志分别保留。
- 重新核对音色库桌面/窄屏、日夜主题及任务历史截图，未见横向溢出。`git diff --check` 通过。
- 所有推理相关浏览器流程使用既有测试替身，未进行真实模型质量听评，也未修改内部引擎、安装独立包或推送代码。
