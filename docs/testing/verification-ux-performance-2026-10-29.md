# 首次创作、备份与读取成本验证（2026-10-29）

本页记录首轮实现；随后审查发现并修复的中断恢复、文件权限与缓存边界问题，以及最终安装状态，见[审查修复记录](verification-review-fixes-2026-10-29.md)。

## 变更范围

- 空工作区先选创作类型，一次命名项目和声音后进入原创作表单；仍需确认生成才运行模型。设置提供按实际启动命令生成的备份与恢复指南。
- 新增停服备份、完整性校验、恢复到新目录的 CLI。保留未知文件、历史目录、空目录与执行权限；不覆盖目标。备份不含浏览器草稿或目录外模型；包含符号链接的工作目录会拒绝操作。
- 查询周期从固定 1.8 秒改为任务活跃 / 状态恢复 1.8 秒、空闲 10 秒、隐藏 30 秒。监控在隐藏页面不采样。没有加入服务端修订号，也没有重写工作台渲染结构。
- 音频缓存独立成模块，合并同路径并发请求，保留容量预算和活动播放器保护。乐谱产物 WAV 在同一文件描述符上校验后流式响应，支持单区间 Range；MP3 转码保持原路径。
- 浏览器仍需完整 Blob 后播放，未宣称实现渐进播放或首播加速；其他音频端点保持现状。没有调整模型或新增音质评价体系。

环境：macOS 27.0.1、Node v25.3.0；Chrome 使用本机 channel，WebKit 使用 Playwright 配套浏览器。源码基于 `efd7294` 的本轮工作区改动，未提交。

## 首次失败与修复

证据目录：`test-results/ux-perf-2026-10-29/`（忽略目录）。

- `baseline.log`（`node --test src/workbench/studio/refresh-loop.test.ts src/workbench/studio/audio-cache.test.ts src/server/workspace-backup.test.ts src/server/audio-file.test.ts`，退出 1，19 通过 / 6 失败）：原刷新延迟、产物 Range 用例失败，备份实现缺失；缓存草稿的已有测试通过。
- `ui-baseline.log`：空工作区缺少快速创作入口。
- `backup-tests.log`：现有目标为链接时错误分类不符，修复后不覆盖目标。
- `restore-mode-red.log`：恢复丢失执行权限；清单与复制流程增加权限保留。
- `studio.log`：旧监控及播放器测试绑定固定两秒轮询，改用可控浏览器时钟验证新节奏，没有延长超时或降低保护阈值。时长表单测试期间发生源码热更新，该轮不作为稳定版本验收；冻结代码后复验。
- `recovery-delay-red.log`：任务已完成但渲染失败时错误进入空闲频率；将恢复状态纳入快速查询条件。

## 验收边界

服务和浏览器业务测试使用隔离目录与测试模型驱动，不代表真实模型推理或听感结论。未进行新一轮真实混合模型、60 分钟长稳、原生 Safari、满盘或独立发布包验收；本轮不发布或替换用户安装的程序。音频性能结论仅限消除整文件响应缓冲、支持区间传输及合并重复读取，没有长音频首播耗时或整机内存峰值的实测对照。


## 执行结果

以下数量按各自日志统计，专项与完整套件有重复覆盖，不相加。

| 执行 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | 113 通过，退出 0 | `unit-final.log` |
| `npm run build` | TypeScript 与 Vite 通过，退出 0 | `build-final-verified.log` |
| `npm run test:service` | 394 通过，退出 0；随后备份权限、恢复与 CLI 的增补由最终专项覆盖 | `service.log` |
| 最终音频 / 备份 / 缓存 / 刷新专项（`node --test`，上述四个测试文件） | 56 通过，退出 0 | `focused-final.log` |
| `npm run test:lyrics-worker` | 12 通过，退出 0 | `lyrics-worker.log` |
| `npm run test:experiments` | Python 14、Node 8 通过，退出 0 | `experiments.log` |
| `npm run verify:score`、`npm run verify:lyrics`、`npm run verify:resources` | 各 1 通过，退出 0 | `score.log`、`lyrics-ui.log`、`resources-ui.log` |
| `npm run verify:studio`（代码冻结后整套重跑） | Chrome 67 通过，退出 0 | `studio-final.log` |
| `npm run verify:webkit` | 9 通过，退出 0 | `webkit.log` |

首次使用截图：`welcome-1440.png`、`welcome-390.png`。已查看实际页面；命名进入语音表单、没有自动生成、重载保留项目与备份指南均由真实浏览器断言。
