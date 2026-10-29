# 审查修复与本机安装（2026-10-29）

## 本轮结论与实现

本轮接续[首次创作与性能优化](verification-ux-performance-2026-10-29.md)，修复代码审查确认的四个缺陷，并收拢刷新调度职责。

- **备份所有权**：服务与备份共用 `workspace-ownership.ts`。恢复锁仅用于同步交接，不再贯穿整个备份；备份被强杀后，正常服务可以回收已退出进程的工作目录锁。正常备份结束保留原来的陈旧锁记录，不初始化源目录。
- **恢复完成协议**：复制前持久化 `.music-room.restore-incomplete`，所有文件与备份校验完成后才删除。服务拒绝打开带标记的目录；中断后的残缺目录不能被当作完整作品使用，应从原备份恢复到另一个新目录。
- **只读文件**：副本在同步期间使用临时可写权限，完成后恢复原权限；源文件不改动。覆盖 0444、0400 和可执行文件。
- **音频请求归属**：`releaseUnused` 仅释放无使用者的已完成 URL；`invalidate(path)` 只取消指定资源；页面销毁才取消全部请求。删除按照版本所属项目 / 声音定位音频，不误取消无关的读取。
- **刷新生命周期**：`RefreshLoop` 管理定时器、执行中状态、提前刷新期限和销毁；活跃 / 空闲 / 隐藏 / 恢复条件只由工作台的一处状态函数提供。新事件不能无限推迟已有刷新，也不能在销毁后重新启动循环。

## 失败与回归证据

证据目录：`test-results/review-fixes-2026-10-29/`，不提交测试产物和用户数据。

| 阶段 | 命令与证据 | 结论 |
| --- | --- | --- |
| 缺陷复现 | `node --test src/server/workspace-backup.test.ts src/workbench/studio/audio-cache.test.ts` → `red.log` | 原实现失败：只读文件、备份强杀、恢复强杀、缓存操作边界 |
| 调度器红灯 | `node --test src/workbench/studio/refresh-loop.test.ts` → `coordinator-red.log` | 缺少集中管理的生命周期实现 |
| 首轮修复 | `first-fix.log` | 指定路径取消测试迁移时传入路径不符；保留失败，随后使用各场景的真实路径修正 |
| 最终专项 | 上述测试另加 `src/workbench/studio/refresh-loop.test.ts src/service/projects/store.test.ts` → `focused.log` | 62 通过，退出 0 |
| 浏览器音频专项 | `node --test --test-timeout=90000 scripts/verify-audio-loading-ui.test.mjs` → `audio-ui.log` | 3 通过，退出 0；无关永久删除期间，当前请求不取消、不重复读取且最终可播放 |

强杀用例使用本轮隔离子进程和目录，实际等待复制 / 备份开始后发送 SIGKILL。恢复用例确认 100 个文件尚未复制完，再验证服务拒绝打开残缺目录。测试不会停止用户的生产服务。

## 验收范围

服务替身、真实模型队列、独立包和人工听评分别报告。本轮不改变模型效果或要求新的音质评价。完整命令、最终计数、包哈希与本机安装结果见以下执行结果。


## 首轮环境异常

- `verify-all.log`：首轮浏览器阶段遇到主机休眠，多个原本秒级的用例出现 5–16 分钟等待；停止了本轮卡住的测试进程树，随后以 `verify-all-isolated.log` 保留整套重跑结果。没有改超时或断言。
- `sleep-evidence.log`：macOS 电源日志记录了 2026-10-29 19:01–19:38 的维护休眠与唤醒。期间的浏览器耗时和长稳连续性不能作为性能验收依据。
- `mixed-real.log`：首轮真实 TTS 成功，转换进入系统内存压力保护而失败，音乐未完成；没有降低保护阈值。报告在 `test-results/mixed-real/run-1793271146981/verification.json`。
- 一小时长稳使用 `MUSIC_ROOM_SOAK_MINUTES=60`，证据位于 `soak/verification.json`。即使脚本按墙钟时间完成，由于中途休眠，也不能记作连续运行一小时通过。

## 最终执行结果

| 执行 | 结果 | 证据 |
| --- | --- | --- |
| `npm run verify:all`（唤醒后整套重跑） | 退出 0：单元 115、服务 401、Chrome 工作台 68、乐谱 / 歌词 / 资源界面各 1；Python 歌词 12、实验 Python 14 与 Node 8 均通过；构建通过 | `verify-all-isolated.log` |
| `npm run verify:webkit` | 9 通过，退出 0 | `webkit.log` |
| `npm run build:binary` | Bun 1.4.2，81 个内嵌文件，141,335,922 字节，退出 0 | `build-binary.log` |
| `npm run verify:binary` | 20 项通过，无浏览器错误，退出 0；含新增只读备份恢复和真实 40 秒乐谱 WAV、50 秒调速 WAV | `binary.log`；`test-results/binary/verification.json` |
| `npm run verify:resources:binary:real` | 7 项通过，退出 0；真实语音、低限额拒绝、暂停恢复、取消、强杀清理、重启重试与正常停服 | `binary-resource-real.log`；`test-results/resources-real/binary-1793274761907/verification.json` |
| `MUSIC_ROOM_SOAK_MINUTES=60 npm run verify:soak` | 脚本退出 0，664 轮、66 次服务重开，原件 / 队列 / 内存断言通过；**休眠破坏连续性，连续一小时长稳仍待验收** | `soak.log`、`soak/verification.json`、`sleep-evidence.log` |

各套件存在重复覆盖，不累加成一个通过总数。长稳样本中服务 RSS 从预热约 164 MiB 至采样峰值约 246 MiB，低于原有增长保护阈值；不把休眠期间的墙钟耗时当作持续负载时间。

独立包 SHA-256：`39d5db7705d70e49a0fa16db116e107c339bf2aef02469e31f0adebc911b013e`。

## 真实混合队列的未通过项

隔离重跑的 `mixed-real-isolated.log` 记录真实 TTS 和音色转换成功；音乐固定用例 Q-MUSIC-01、seed 42 在三次规划后仍未达到目标时长或完整乐谱要求，未进入音频合成，套件退出 1。报告：`test-results/mixed-real/run-1793274861990/verification.json`。结束时队列为空、无活动任务、无驻留模型。

本轮未修改模型规划和时长规则，也没有改种子、降低门槛或跳过断言以制造通过。此次安装针对已验证的工作台、备份、缓存与生命周期修复；**真实音乐规划用例仍未通过，连续一小时长稳仍待验收**，不能称作全量发布验收通过。

## 本机安装

- 2026-10-29 19:59（北京时间）更新 `/Users/liu_y/Applications/MusicRoom/music-room`、`start.sh` 与构建清单。
- 安装前检查没有运行 / 排队任务，正常停止原服务后替换程序并重新启动；原端口 57923 保留，地址为 `http://127.0.0.1:57923`。
- 已验证新服务后台运行、状态查询正常、实际提供包含备份入口的新工作台资源；安装文件哈希与上述验收包一致。
- 安装前后逐个核对本地 91 个音频 / 乐谱原件的大小和 SHA-256，全部不变。未替换用户模型或工作目录。
- 证据：`installation.json`、`install.log`、`install-integrity-before.log`、`install-integrity-after.log`。旧可执行文件与启动脚本保存在本轮忽略目录 `previous-install/`，供必要时回退。
