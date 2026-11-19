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
