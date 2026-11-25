# 2026-11-19 创作空间改造 · 执行记录

依据：[创作空间整体改造方案](../design/studio-redesign.md)。本页只记录本次执行的实际结果；日志在 `test-results/redesign/`（不提交）。

## 范围与环境

- macOS Apple Silicon，本机 Google Chrome（Playwright `channel:'chrome'`），Node v25.3.0。
- 工作区在改造开始前已有 28 个未提交文件（音效相关，非本次改动），本次改动叠加其上。
- 所有浏览器测试使用测试驱动与隔离工作目录，不代表真实模型推理验收。

## 改造前基线

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | 119 / 119 通过 | `p1-baseline-unit.log` |
| `npm run build` | 通过 | `p1-baseline-build.log` |
| `npm run verify:studio` | 79 / 79 通过（425 s） | `p1-baseline-studio.log` |

## P1 视觉基础

改动：新增 `tokens.css`（日 / 夜 token 与旧变量别名）、`base.css`（衬线标题、印记、主题切换、图标间距）、`icons.ts`（16px 线性图标）；`theme.ts` 支持日间 / 夜间 / 跟随系统，侧栏底部为日夜切换，设置里为三选一，移除右上角浮动切换；所有工作区 CSS 字号映射到 6 档 token，圆角映射到 4 / 6，颜色字面量改为 token；界面 Unicode 字形图标替换为 SVG（正文里的箭头说明文字保留）；「保留灵感」改为「留作灵感」，「已选为成品」使用朱红线框，灵感标签使用描边印记；版本选中行去掉左侧色条；MIDI 工具配色改用 token。

**首次运行**（`p1-studio-run1.log`）：75 / 79，4 项失败，均为旧视觉或旧文案断言：

| 用例 | 失败原因 | 处理 |
| --- | --- | --- |
| verify-monitor-ui：侧栏导航字号 | 断言 16px；规范为 14px | 改为断言 14px |
| verify-monitor-ui：资源表高度 < 150 | 字号统一为 12px 后表格变高 | 收紧表格行距（`monitor.css`），保留原阈值；复验通过 |
| verify-studio-conversion-ui：弹窗遮罩颜色 | 断言旧遮罩 `rgba(8, 12, 9, 0.72)` | 改为断言新 `--scrim`（日间 / 夜间各一值） |
| verify-player-menu-ui：灵感按钮文字 | 等待「已保留」 | 改为等待「已留作灵感」 |
| verify-studio-ui：开始创作按钮 | 去掉「＋」字形后与空状态按钮同名，严格模式命中 2 个 | 改为定位页头 `.project-actions [data-action="compose"]` |

同一轮还按新规范修改了：主题与侧栏断言（侧栏底部有日 / 夜两枚按钮，不再有 `.studio-topbar`）、日夜底色与 `--ink-2` / `--hair` 取值、「新建项目」「开始创作」「试听比较」按钮名称。

**复验**：

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| 失败的 4 个文件单独复跑 | 17 / 18，资源表高度仍失败 → 修复后 1 / 1 | `p1-studio-rerun-failed.log`、`p1-monitor-rerun.log` |
| `npm test` | 119 / 119 | `p1-unit.log` |
| `npm run verify:studio` | 79 / 79 | `p1-studio-run2.log` |
| `npm run verify:score` | 1 / 1 | `p1-score.log` |
| `npm run verify:lyrics` | 1 / 1 | `p1-lyrics.log` |
| `npm run verify:resources` | 1 / 1 | `p1-resources.log` |

未执行：`npm run test:service`（后端未改动）、`verify:webkit`、`verify:system:zoom`（并入 P2 结束后一起执行）。人工截图检查见 `/tmp` 下的日 / 夜、1440 / 1024 / 390 截图，未提交。

## P2 外壳与导航

改动：侧栏项目列表完整列出并在列表内滚动（移除分页，`projectPage` → `projectMatches`）；全局入口改为「声音库 / 音色库 / 任务与资源」，「任务与资源」右侧显示一行实时状态；侧栏 CPU/内存表改为一行内存状态（点击进入任务与资源）；新增「任务与资源」页（本机资源分布条、模型驻留与释放、详细数据折叠、进行中与排队含逐项取消与启动预约、历史）；设置由弹窗改为页面（模型、内存与资源、回收站、备份与恢复、Agent 连接、外观三选一、关于）；底部播放条与弹窗不再显示任务摘要；「查看内存状态」进入任务与资源；从其他页面点回当前项目时保留原声音与版本。

**首次运行**（`p2-studio-run1.log` 等）：studio 68 / 79、lyrics 0 / 1、resources 1 / 1、score 1 / 1。

| 用例 | 失败原因 | 处理 |
| --- | --- | --- |
| task-queue（3 项）、music-progress、playback-navigation（3 项） | **产品缺陷**：旧服务或测试替身返回的 `resource_status` 缺少 `residents` / `history`，`resourceOverview` 抛错，被 `refreshResources` 当作断线 | `resourceOverview` 对缺省字段容错；新增单元测试「tolerates partial status」 |
| monitor | 任务页「调整内存上限」也带 `data-action="settings"`，测试定位不唯一 | 测试改为定位侧栏设置按钮 |
| sound-library | 断言旧入口顺序「音色库在声音库前」 | 改为断言新顺序「声音库在音色库前」 |
| studio-ui · 批量删除与恢复 | 恢复后回项目页，渲染在刷新完成后才发生，立即计数为 0 | 等待版本行出现后再计数 |
| studio-ui · 层级回收站 | 点回项目会重置为默认声音 | **行为改进**：点回当前项目时保留原声音与版本 |
| lyrics | 改写的用例离开项目页查看队列，暂停中的播放器回来后不是同一元素 | 用例改为留在项目页，从播放器歌词区读取进度，从侧栏读取队列状态；任务页歌词进度由 task-queue 用例覆盖 |

**第二轮**（`p2-studio-run2.log` 等）：studio 79 / 79、lyrics 1 / 1、score 1 / 1、WebKit 17 / 17；resources 0 / 1。

| 用例 | 失败原因 | 处理 |
| --- | --- | --- |
| resources · 保存内存上限（连续 3 次运行中 2 次失败） | **产品缺陷**：打开设置时发起的首次资源读取若晚于用户输入返回，会把输入框改回旧值；并发的资源读取被直接丢弃，保存后可能看不到新上限 | 资源读取改为合并后续请求（保存后等待一次新的读取）；用户编辑过的上限输入不再被初次读取覆盖；复验连续 5 / 5 通过 |

**最终复验**（同一构建）：

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | 123 / 123 | `p2-unit-3.log` |
| `npm run verify:studio` | 79 / 79 | `p2-studio-run3.log` |
| `npm run verify:lyrics` | 1 / 1 | `p2-lyrics-run3.log` |
| `npm run verify:score` | 1 / 1 | `p2-score-run3.log` |
| `npm run verify:resources` | 5 次连续 5 / 5 | `p2-resources-run4-*.log` |
| `npm run verify:webkit` | 17 / 17 | `p2-webkit-2.log` |

**未执行**：`npm run verify:system:zoom` 需要带已完成语音版本的隔离运行工作区（`MUSIC_ROOM_SYSTEM_WORKSPACE`），本轮未准备，脚本中设置与回收站的定位已随页面改造同步更新，待下次执行；`npm run test:service`（后端未改动）；原生 Safari。

## 任务与资源页精简（用户反馈「太堆砌」）

改动：页面顺序改为「进行中与排队 → 本机资源 → 历史」；本机资源默认只显示一句概要（新任务可用 / 应用上限 / 总内存）、一条细分布条和已加载模型，图例、估算明细、CPU 与最近记录收进「详细数据」；历史由表格改为单行列表（状态 · 标题与项目 · 结果 · 时间 · 试听 / 复用参数），去掉与标题重复的「查看生成结果」按钮，筛选只显示有数量的状态，日期按「今天 hh:mm」显示；空闲时队列只显示一行。

首次运行：受影响的 7 个浏览器文件 22 / 23。`verify-resources-ui` 失败：队列在暂停状态下清空后显示「队列已暂停 · 等待 0 项」，用例按「后台空闲」等待，属断言错误，改为断言暂停文案与无队列行；随后连续 3 次通过。

复验（同一构建）：`npm test` 123 / 123，`verify:studio` 79 / 79，`verify:lyrics` 1 / 1，`verify:score` 1 / 1，`verify:resources` 3 次 1 / 1，`verify:webkit` 17 / 17。另在真实数据副本（189 条历史）上检查日 / 夜 1440 与 390 截图。

## 音乐生成 8 GiB 预算收紧与各功能内存用途展示

改动：
1. `src/service/resources/profiles.ts`：YuE2 低内存 MLX 模式的启动预约与运行保护上限由 `14 GiB + prefixTokens × 224 KiB` 收紧为 `8 GiB`（覆盖实测 4.1–6.1 GiB 峰值，同时将传给 YuE2 的 `memory_budget_gib` 锁在 8.0 GiB）。
2. `src/workbench/studio/resources.ts`、`pages.css`：「任务与资源 → 本机资源」进度条下方直接展示 4 段内存分布图例（并标明「本程序」当前是后台基础服务、含驻留模型还是正在运行某生成任务及其实时采样占用），以及「各功能内存需求」清单（同步歌词、音效、Breeze 语音、IndexTTS 语音、YuE2 音乐、UVR 参考清理、Seed-VC 音色转换的所需内存与当前可运行/差额状态），说明所有任务排队串行、按需加载、用完即卸。

执行记录：
- 红灯阶段：`node --test src/service/resources/profiles.test.ts src/workbench/studio/resources.test.ts` 12 / 15 通过，3 项新增/更新断言按预期失败。
- 修复与构建后复验：
  - `npm test`：124 / 124 通过。
  - `npm run build`：通过。
  - `node --test --test-timeout=60000 --test-concurrency=1 src/service/resources/*.test.ts src/service/yue2/*.test.ts`：122 / 122 通过（首次在受限沙箱内因 `EPERM` 无法调用本机 `/bin/ps` 与 Python，切换正常本机环境后 122 / 122 全过）。
  - Chrome 浏览器回归（`verify-resources-ui.test.mjs`、`verify-monitor-ui.test.mjs`、`verify-task-history-ui.test.mjs`、`verify-task-queue-ui.test.mjs`、`verify-browser-compat.test.mjs`）：7 / 7 通过（首次在无回环网络沙箱内报 `ERR_ACCESS_DENIED`，切换正常本机环境后 7 / 7 全过；桌面 1280×900 与手机 390×844 截图见 `test-results/resources-ui/`）。
  - WebKit 兼容回归（`verify-browser-compat.test.mjs`、`verify-task-history-ui.test.mjs`）：2 / 2 通过。
- 真实模型推理本轮未重跑（仅收紧准入与预算上限，未改变模型权重与推理代码）。

## 资源审查修复复验

YuE2 从 8 GiB 起，按档位和上下文计入两阶段缓存。资源页沿用后台准入规则，断线时显示未知，等待资源时只显示任务阶段。协调器结束任务时清除该任务的实时采样。

- 红灯定向回归共 30 项，26 通过、4 失败，复现长输入预约不足、断线后继续显示可运行、等待状态误报及采样串到下一任务。修复后同组 30 项通过。首次构建暴露测试夹具类型缺失，补齐字段后通过。
- `npm run verify:all` 通过。单元 125 项、服务 430 项，Chrome 工作台 79 项，乐谱、歌词和资源页各 1 项。资源页覆盖接口断线与恢复、音乐起步额度、手动上限和 390px 布局。
- WebKit 资源页专项 1 / 1 通过。全量 WebKit 两次均为 16 / 17，播放队列刷新后恢复进度分别在顺序和随机场景超时。该用例单跑 1 / 1、与兼容和草稿合跑 8 / 8。提交版 `ed32bb8` 全量 17 / 17，当前整套 WebKit 仍有间歇超时。
- 在本机 M4 / 32 GiB 的隔离安装中，使用正式资源调度串行完成两次真实 MLX 推理。快档短谱下发 8.0 GiB，采样峰值 4.75 GiB，输出 59.60 秒 FLAC。质量档纯音乐使用 24,572 / 24,576 个上下文 token，下发约 11.50 GiB，采样峰值 9.61 GiB，输出 10.88 秒 FLAC，保存的乐谱与输入一致。
- 两次推理均报告完成。验收脚本先后因配置文件路径和音频字节断言写法失败，保留原始日志。对已生成文件重新读取，确认上游实际预算、FLAC 文件头、解码、非静音和哈希。此次覆盖两个样本，人工听评、独立包和 60 分钟长稳仍待验收。

日志及真实模型结果保存在 [本轮执行目录](../../test-results/resource-fixes-2026-11-19.ilY7y3/)。

## 预算定义、采样一致性与播放位置

资源清单复用任务启动和运行预算。摘要与清单使用同一采样有效性规则。三段内存分布按总容量绘制，系统保留额度独立标注。播放队列在用户拖动底栏进度时保存目标位置，刷新可在浏览器确认跳转前恢复同一首的进度。

- 定向红灯记录保留了 3 项资源页失败。WebKit 模拟媒体尚未确认跳转，发现旧版本在刷新前保存了 0 秒，目标是 1.3 秒。修复后，同一用例覆盖了顺序和随机队列的实际底栏操作与刷新恢复。
- `npm run verify:all` 通过。单元 126 项、服务 430 项，Chrome 工作台 79 项，乐谱、歌词和资源页各 1 项。
- 全量 WebKit 17 / 17。资源页 WebKit 专项 1 / 1。Chrome 实际 200% 缩放下，720px 的 CSS 视口中资源块和预算清单均在视口内。
- 本次复验沿用上一节的两组真实 YuE2 结果。此次整理保持原有模型预算参数，实测范围仍为两个样本。

保留 [红灯及复验日志](../../test-results/resource-push-2026-11-19.u7mUW0/)。
