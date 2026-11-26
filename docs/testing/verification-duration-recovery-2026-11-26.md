# 2026-11-26 YuE2 时长容差与过期恢复点修复

## 问题与原因

针对日常工作区 `~/Music/MusicRoom` 中历史失败任务（含 `13 暗夜探戈 · 演唱 · ABC 谱 · V3` 与 `01 楚帐卸甲 · 演唱 · ABC 谱 · V3`）排查确认三个原因：

1. **脏恢复点死循环**：旧运行环境生成出可播放但未通过时长校验的音频（155.8 秒 / 157.4 秒对照 240 秒目标）并写入 `checkpoints/state.json` 后，重生成时沿用旧 `synthesis` 恢复点与同一种子，22 秒内直接重导出同一份 latent 并再次失败。
2. **已生成音频无法从工作台试听**：`validate_audio_duration` 对超出容差的音频抛出 `ValueError`，将任务标为 `failed`。两首歌原有的 FLAC 仍在磁盘，已确认可完整解码，分别为 155.76 秒和 157.36 秒。
3. **规划容差过严且重规划升温**：规划及最终校验容差为 `±15%`，且针对有效但偏离目标的乐谱重规划时会叠加 `RETRY_SAMPLING` 升温（`0.7 -> 0.85 -> 1.0`），导致后续尝试破坏 ABC 语法。

## 改动摘要

- **保留已完成音频并放宽规划容差（`±30%`）**：
  - [duration.py](../../public/yue2-runtime/duration.py)：将 `TOLERANCE` 从 `0.15` 调至 `0.30`，版本配置 `duration_config['version']` 升至 `7`；`plan_for_duration` 在仅附带 `duration_correction` 重规划时保持 `base_sampling`（仅在上一轮截断或语法出错时才升高采样温度）；`validate_audio_duration` 在音频时长为有效有限正数时写入 `duration.json`（含 `targetSeconds`、`tolerance`、`audioSeconds`、`audioWithinTarget`）并正常完成任务，仅在缺失或非正/无效时长时报错失败。
  - 同步 [worker.ts](../../src/service/yue2/worker.ts) 中 `musicRuntimeHashes` 及 [profiles.ts](../../src/service/resources/profiles.ts) 资源哈希，更新 [duration.ts](../../src/service/yue2/duration.ts)、[context.ts](../../src/service/yue2/context.ts)、[authoring-guide.ts](../../src/service/yue2/authoring-guide.ts)、[operations.ts](../../src/service/operations.ts)、[music-creation.ts](../../src/workbench/studio/music-creation.ts) 及文档描述。
- **拒绝并清理过期 / 未过时长检查恢复点**：
  - [recovery.py](../../public/yue2-runtime/recovery.py) 与 [recovery.ts](../../src/service/yue2/recovery.ts)：当 `duration.json` 标记未通过（`audioWithinTarget === false`、`accepted === false` 或 `withinTarget === false`），或 `tolerance` 与当前配置（`0.30`）不一致时，拒绝继续生成且不对外暴露 `recovery`。
  - [studio.ts](../../src/service/studio/studio.ts)：`sync()` 补充轮询已持久化带恢复点的 `failed` / `cancelled` / `interrupted` 音乐任务（含 `musicAttempts` 历史项），同步清空失效 `recovery` 标记，使后续重试改为轮换新种子从头生成。
- **前端非阻塞偏差提示**：
  - [contracts.ts](../../src/service/yue2/contracts.ts)、[ending.ts](../../src/service/yue2/ending.ts)、[proxy.ts](../../src/service/yue2/proxy.ts)、[app.ts](../../src/workbench/studio/app.ts)：透传 `durationCheck`，对实际时长超出 `±30%` 但已完整生成的作品展示非阻塞提示 `#music-duration-warning` 及创作要求详情说明。
- **回归中顺带修复预存侧栏布局媒体查询阈值**：
  - 全量验证首次暴露 [verify-task-history-ui.test.mjs](../../scripts/verify/verify-task-history-ui.test.mjs#L29) 在 `900×600` 视口下失败，原因为工作区预存未提交改动中 [instrument.css](../../src/workbench/studio/instrument.css#L169) 的 `@media(min-width:651px) and (max-height:650px)` 误命中 `600px` 桌面窗口高度。将其收窄为 `max-height:520px`，仅作用于 200% 真实缩放等超矮视口（`720×456`），保留桌面窗口底部设置入口可见。

## 执行与复验记录

除另有说明外，日志文件均保存在 `test-results/duration-recovery-2026-11-26/`。

### 首次失败留档（红灯与前置回归）

| 阶段 | 命令与环境 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 补写失败用例（修复前） | `duration_runtime_test.py`、`recovery_runtime_test.py`、Node `duration`/`recovery`/`managed`/`music-retry` 与 Chrome `verify-music-duration-ui.test.mjs` | `duration_runtime_test.py` 22 项（2 失败、4 错误）；`recovery_runtime_test.py` 11 项（1 失败）；Node 27 项（22 通过、5 失败）；浏览器时长 UI 1 项（0 通过、1 失败） | `first-red.log` |
| 首轮全量回归 | `npm run verify:all` | 单元测试 123 / 123、构建通过、服务 451 / 451、歌词 Python 12 / 12、实验 14 + 8 / 8；`verify:studio` 85 项（84 通过、1 失败：`verify-task-history-ui.test.mjs:29`）导致后续 `verify:score`/`verify:lyrics`/`verify:resources` 中止 | `verify-all.log` |

### 修复后专项与全量复验

| 阶段 | 命令与环境 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 定向测试绿灯 | `recovery_runtime_test.py` + 5 个服务/资源测试 + Chrome `verify-music-duration-ui.test.mjs` | `recovery_runtime_test.py` 11 / 11 通过；Node 服务与资源 40 / 40 通过；浏览器时长 UI 1 / 1 通过 | `targeted-green.log` |
| 重试与侧栏历史双引擎复验 | `music-retry.test.ts` + Chrome & WebKit `verify-task-history-ui.test.mjs` | `music-retry.test.ts` 7 / 7 通过；Chrome 1 / 1 通过；WebKit 1 / 1 通过 | `task-history-fix.log` |
| 完整日常回归 | `npm run verify:all` | 全部退出码 `0`：`npm test` 123 / 123、`npm run build` 通过、`test:service` 451 / 451、`test:lyrics-worker` 12 / 12、`test:experiments` Python 14 / 14 + Node 8 / 8、`verify:studio` 85 / 85、`verify:score` 2 / 2、`verify:lyrics` 1 / 1、`verify:resources` 1 / 1 | `verify-all-green.log` |
| 独立安装包构建 | `npm run build:binary`（顺序执行） | 构建成功：`release/music-room`（`137.53 MiB`、`84` 个内嵌文件、Bun `1.4.2`），SHA-256 `55c38381bbaf6305c643a6eb21117e45569bc02b5bd5c5a8b6d83ad139975dd2` | `build-binary.log` |
| 独立包标准验收 | `npm run verify:binary`（顺序执行） | 24 项检查全部通过，`errors: []`，`binaryBytes: 144209010` | `verify-binary.log` |
| 独立包 YuE2 时长与分词器校验 | `MUSIC_ROOM_YUE2_DIRECTORY="$HOME/Music/YuE2" node scripts/verify/verify-duration-binary.mjs`（无模型推理） | 通过：`Copied binary: target contract, actual tokenizer, packaged ABC duration check and no model loading passed.` | `verify-duration-binary.log` |
| 真实浏览器 200% 缩放检查 | 隔离目录 `test-results/duration-recovery-2026-11-26/zoom-ws` + `release/music-room` 随机端口 + Chrome `npm run verify:system:zoom` | 通过：`dpr: 2`、`innerWidth: 720`、`height: 456`、`scrollWidth: 720`，日夜共 16 张截图无横向溢出 | `verify-zoom.log` |

## 本机日常服务更新与冒烟检查

- 安装路径：`/Users/liu_y/Applications/MusicRoom/music-room`（SHA-256 `55c38381bbaf6305c643a6eb21117e45569bc02b5bd5c5a8b6d83ad139975dd2`，与 `release/music-room` 一致）。
- 旧版本备份：`/Users/liu_y/Applications/MusicRoom/music-room.before-duration-fix-20261126`（SHA-256 `713706c52b6d4a6debfe254cc4cce9d6ceb816fa49d18dda838ccab0e420deef`）。
- 更新前确认 `~/Music/MusicRoom` 服务处于空闲（`active: null`、`queuedCount: 0`）；停服替换后以 `--port 57923` 重启至 `http://127.0.0.1:57923/`（`pid: 17660`）。
- 冒烟验证（`live-smoke.json`）：
  - `GET http://127.0.0.1:57923/` 返回 `200`。
  - 工作台接口返回 `10` 个项目、`146` 个未彻底删除的声音、`279` 个未彻底删除的版本。持久化索引含彻底删除记录，共 `153` 个声音、`322` 个版本。
  - 实时查询确认 `13 暗夜探戈 · 演唱 · ABC 谱` V3（2 条 `musicAttempts`）与 `01 楚帐卸甲 · 演唱 · ABC 谱` V3（3 条 `musicAttempts`）的 `musicRecovery` 及各条 `attempt.recovery` 均已刷新为 `null`（不会再命中旧 `synthesis` 恢复点死循环）。

## 未覆盖边界

以上自动化测试及独立包检查均使用测试替身、夹具音频与静态分词器校验完成；本轮未启动 YuE2 真实 GPU/MLX 音频推理，也未对重生成结果执行人工听评与独立歌词真值核对。

## 自动时长恢复点补充修复

旧版自动时长的恢复清单可被服务标为可继续，实际引擎会因时长策略已升级拒绝它。隔离复现中连续两次在开始生成前失败。服务与引擎现在都核对时长策略，过期或无法确认策略的多阶段恢复点会让重试使用新种子。新清单记下策略版本，上一版有当前容差记录的恢复点也可以继续。

首次失败和复验保存在 `test-results/duration-recovery-policy-2026-11-26/`。`first-red.log` 记录服务与 Python 的失败；`targeted-green.log` 记录 32 项服务专项通过，包含旧自动时长文件、直接继续请求和连续恢复。真实模型质量与人工听评独立于规则回归。

`npm run verify:all` 通过，含 124 项单元、457 项服务、12 项歌词 Python、14 项 Python 与 8 项 Node 实验、86 项工作台浏览器、2 项乐谱、1 项歌词界面、2 项资源界面测试。原始结果见 `verify-all.log`。

独立包通过 `npm run verify:binary` 的 24 项检查及实际分词器和时长校验。包 SHA-256 为 `23bcd23f7d6b7bd41074140e00bdd2a3cecdf5323961f27ea154ef889d0a4067`。安装验收以 `~/Applications/MusicRoom/installed-build.json` 的源码提交、包哈希和备份路径为准。

隔离独立包的真实 MLX 验收使用预计 16 秒的固定乐谱和自动时长。引擎进入音乐内容生成，系统持续交换写出触发原有保护，任务停止。原始结果保存在 `real-yue2.log`。真实成品播放和人工听评待验收。
