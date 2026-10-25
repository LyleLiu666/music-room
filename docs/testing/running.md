# 测试执行指南

返回[测试入口](../testing.md)。先按改动选范围，再运行对应命令；真实模型套件依次执行。

## 执行前

- 使用隔离工作目录及固定模型安装。确认目录归本轮测试所有；不向用户项目生成样本。
- 日常浏览器需要本机 Chrome；WebKit 首次运行前执行 `npx playwright install webkit`。页面读取 `dist/`，先构建。
- 转换、安装和下载保留真实磁盘的 2 GiB 储备检查。固定语料的大模型组额外要求至少 10 GiB 可用空间；内存压力偏高时先等待恢复，不降低保护阈值。
- 模型隔离使用 macOS `/bin/cp -c` 强制 APFS 克隆。克隆失败停止，不退回完整复制；Node 的 `COPYFILE_FICLONE` 在本平台可能静默全量复制。
- 记录提交、未提交差异、OS / CPU / 内存、Node / Bun / 浏览器及模型版本。先建立本轮证据目录，再启动测试。

## 常规回归与独立包

| 范围 | 命令 | 通过标准 / 产物 |
| --- | --- | --- |
| 全量日常 | `npm run verify:all` | 所有子命令成功，无遗漏或意外跳过 |
| 逻辑 / 执行器 | `npm test` | 单元断言与测试入口、续跑、质量证据门禁通过 |
| 服务 / HTTP / MCP | `npm run test:service` | 串行执行；每项最多 60 秒 |
| Chrome 分项 | `npm run verify:studio`、`verify:score`、`verify:lyrics`、`verify:resources` | 先构建；每项最多 90 秒；保留失败日志与截图 |
| WebKit | `npm run verify:webkit` | 键盘、表单、多窗口草稿、音频、下载、窄屏；记录引擎版本 |
| 独立包 | `npm run build:binary && npm run verify:binary` | 无 Node/Bun PATH，移走松散资源后 MCP、渲染、调速、下载和重开通过；`test-results/binary/verification.json` |
| 独立包声音库专项 | 构建后 `npm run verify:library:binary` | 真实独立进程、无 Node/Bun PATH；隔离的 45 首 WAV 夹具，验证分页、跨页连播、列表保存、故障恢复、刷新及队列上限；不替代完整包渲染验收 |
| 规模短测 | `npm run verify:soak` | 默认 2,000 历史版本、40 轮、4 次服务重开；`test-results/soak/verification.json` |
| 一小时长稳 | `MUSIC_ROOM_SOAK_MINUTES=60 npm run verify:soak` | 实际连续运行至少 3,600 秒；队列、原件、耗时与内存断言通过 |
| 独立试验台 | `npm run test:trials` | Python 与 Node / 浏览器测试通过 |

构建会改动 `dist/` 和原生构建目录，独立包验证还会临时移动松散资源。它们与引用这些目录的测试顺序执行；多个构建也不要并行。资源保护为全机共享，一个真实模型套件运行时，另一工作目录被拒绝不是可以绕过的限制。

规模脚本使用确定性模型驱动、真实 HTTP 和持久化。服务与客户端分别记录 RSS；同一服务进程关闭重开，每次采样前 GC。服务预热后的常驻增长门禁为 256 MiB，不能用提高阈值消除失败。报告包含实际时长、源文件哈希、RSS、系统压力、交换空间与磁盘抽样。该结果不证明真实模型吞吐量，最高采样也不等于生产瞬时峰值。

## 真实模型

以下示例中的绝对路径需替换为本轮隔离目录。`隔离模型` 内包含脚本准备的 `tts/` 与 `yue/` 安装；转换和歌词运行时仍需本机已有相应安装。首次准备与安装细节见[模型资源](../model-resources.md)。

| 范围 | 命令 / 前置条件 | 必须保留 |
| --- | --- | --- |
| 固定语料 | 先 `npm run prepare:quality`，再 `MUSIC_ROOM_QUALITY_REAL=1 MUSIC_ROOM_RESOURCE_RUN=/绝对路径/隔离模型 npm run verify:quality:real` | `test-results/quality/real/execution.json`、各次音频和推理日志；详见[质量标准](quality.md) |
| 资源校准 | `MUSIC_ROOM_RESOURCE_RUN=/绝对路径/隔离模型 npm run verify:resources:real` | 安装目录内 `verification.json`；真实 TTS、两次参考清理、转换和 YuE2 两档 |
| 正式策略混合队列 | `MUSIC_ROOM_MIXED_REAL=1 MUSIC_ROOM_RESOURCE_RUN=/绝对路径/隔离模型 npm run verify:mixed:real` | `test-results/mixed-real/run-*/verification.json`；暂停、排队取消、恢复、真实引擎完成和释放 |
| 原提示词规划回归 | `MUSIC_ROOM_PLANNING_REAL=1 MUSIC_ROOM_RESOURCE_RUN=/绝对路径/隔离模型 npm run verify:music:planning:real` | `test-results/music-planning/run-*/verification.json`；固定原提示词与种子，保存每次乐谱、采样参数及完整音频 |
| 独立包资源保护 | 先构建独立包，再 `MUSIC_ROOM_RESOURCE_RUN=/绝对路径/隔离模型 npm run verify:resources:binary:real` | `test-results/resources-real/binary-*/verification.json`；低限额拒绝、暂停恢复、运行中取消、SIGKILL 清理和重启 |
| TTS 浏览器与默认配置 | 在已启动且装有真实模型的隔离服务上运行 `MUSIC_ROOM_TTS_REAL=1 MUSIC_ROOM_WORKSPACE=/绝对路径/隔离工作区 npm run verify:tts:real` | `test-results/speech-real/`；实际生成、播放、下载、成品和刷新恢复 |
| YuE2 独立包 | `MUSIC_ROOM_YUE2_REAL=1 MUSIC_ROOM_WORKSPACE=/绝对路径/隔离工作区 MUSIC_ROOM_YUE2_DIRECTORY=/绝对路径/隔离模型/yue npm run verify:yue2:real` | `test-results/yue2-real/verification.json`；正式 stdio MCP、真实 MLX、FLAC 下载和 Chrome 播放 |

资源校准与产品使用相同的原生进程占用和系统内存计数器，不用高负载下易超时的 `vmmap` 代替。校准脚本明确使用 6 / 8 / 10 / 14 GiB 的校准限额，测量真实峰值；不能把限额当作实测值，也不能据此宣称正式策略通过。混合队列、固定语料和独立包资源验收才使用正式策略。两类结果分别报告。

混合队列的音乐输入直接取自固定语料 `Q-MUSIC-01`，保留种子、请求和语料哈希；仍运行完整真实模型。自由创作提示词可能触发规划长度上限，此类失败保留在质量记录中，不能拿修改提示词后的成功声称原问题已修复。

`MUSIC-PLAN-02` 专门复验三次规划失败的原始输入，不使用混合队列的替代样本。独立包验收可为 `verify:yue2:real` 指定 `MUSIC_ROOM_YUE2_CASE=tests/quality/music-planning-regression.json` 和独立的 `MUSIC_ROOM_YUE2_OUT`，其余模型目录与工作目录变量同普通真实音乐验收。输入不改写、不设置目标时长、不提供预制乐谱；结果仍须完成真实推理、下载和浏览器播放。

固定语料默认在同一个执行目录续跑。成功样本复用前核对请求、种子 / 速率、模型记录、输入指纹及音频哈希，日志必须可读且非空；新记录还核对日志哈希。异常直接失败，不能静默重生成并覆盖旧证据。改变输入、模型或需要重新验收的生成行为时使用新的 `MUSIC_ROOM_QUALITY_RUN`。旧记录缺少日志哈希时不补造历史哈希，最终证据清单记录本次实际核验值。

若只运行部分语料，用 `MUSIC_ROOM_QUALITY_CASES` 指定用例编号；报告分别给出本次范围和全量状态。中断、磁盘拒绝、资源保护和失败记录保留。脚本用 macOS 清醒运行时间计算任务超时，异常时等待取消完成；不要用墙上时间将睡眠误判成模型超时。

## 系统场景

| 场景 | 命令 / 条件 | 通过标准 |
| --- | --- | --- |
| 受控满盘 | `MUSIC_ROOM_SYSTEM_DISK=1 npm run verify:system:disk` | 在脚本创建的 64 MiB RAM 卷验证真实 ENOSPC、旧记录 / 安装保护、空间恢复后的保存；结束卸载卷 |
| 浏览器 / 服务生命周期 | `MUSIC_ROOM_SYSTEM_WORKSPACE=/绝对路径/隔离工作区 npm run verify:system:lifecycle` | Chrome 断网重连、关闭所有测试页、隔离服务暂停恢复；不等同整机睡眠 |
| 200% 页面缩放 | 同上设置工作区后 `npm run verify:system:zoom` | 独立 Chrome 配置；核对 DPR、实际宽度与深浅主题关键入口，检查截图 |
| 原生 Safari | 同上设置工作区后 `npm run verify:safari:native` | 用户已开启远程自动化；专用 WebDriver 会话完成弹窗、草稿、真实 WAV 播放及窄屏。记录原生版本，不以 WebKit 代替 |
| 整机断网恢复 | 用户同意的时段，设置 `MUSIC_ROOM_SYSTEM_NETWORK=1 MUSIC_ROOM_NETWORK_INTERFACE=实际Wi-Fi接口` 后运行 `npm run verify:system:network` | 真实关闭默认路由的 Wi-Fi；外网失败、本机音频不变；独立恢复进程兜底，结束确认网络恢复 |
| 实际睡眠 | `npm run observe:system:sleep` 就绪后，由用户睡眠约 30 秒、唤醒解锁，再结束观测器 | 系统睡眠计数、周期编号和采样间隔共同确认；恢复后状态与音频哈希一致，锁屏或暂停请求不算睡眠 |

整机断网和睡眠安排在用户明确同意的窗口。不要为了补证据重新操作无关系统功能。浏览器截图必须与最终页面状态一致，不能只看脚本退出码。

## 留档与清理

每轮记录命令、开始结束时间、退出码、所测源文件 / 包指纹、环境、产物哈希与失败原因。保留首次失败和之后复验；执行器问题与产品问题分开说明。`test-results/` 被 Git 忽略，需要长期保存时按项目制品管理方式另行归档。

先等待自己创建的任务取消 / 完成，再关闭自己的服务和浏览器，检查模型进程及全机资源租约已释放，卸载测试 RAM 卷，释放临时防休眠断言。按 PID 与启动身份核对所有权；不关闭其他工作目录的服务，不清理用户浏览器。

备份先停止所属服务，再复制整个工作目录，包含音频、版本、引擎配置与索引。恢复到新目录验收后再切换入口；不能只复制仍被后台写入的 `studio.json`，也不能把新版写过的目录直接交给旧版当作回滚。
