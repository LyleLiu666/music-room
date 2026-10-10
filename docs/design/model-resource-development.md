# 模型资源管理开发记录

目标与轮次：[设计](model-resource-management.md)、[开发计划](model-resource-management-plan.md)。此页记录开发事实，不能代替最终验收。

## 第一轮：入口核对与调度核心

已完成。本轮提交以 `feat(resources): add hardware admission and serialized task coordinator` 标识。本轮交付核心契约、可注入硬件准入策略、统一有界 FIFO、取消与资源清理；实际业务引擎从第二轮接入。

### 入口核对与接管位置

| 入口/行为 | 当前执行位置 | 接管轮次 |
| --- | --- | --- |
| 网页/MCP 的 direct TTS 与 Studio 语音 | SpeechService.generate → pump → driver.generate | 第二轮 |
| 原生 TTS 驻留、加载及 Python 分支 | native-runtime / python-runtime | 第二轮 |
| 转换上传、重试、Studio 转换 | ConversionService.add/retry → pump → driver.run | 第二轮 |
| 音乐启动、准备后启动、旧 autoStart | YuE2Engine.open/prepare/start → driver.launch | 第三轮（安装部分第五轮） |
| direct YuE2 与 Studio 音乐 | YuE2Client.generate → 上游 HTTP 内部队列 | 第三轮 |
| YuE2 历史同步及音乐播放 | Studio.sync、YuE2Client.list/job/audio | 第三轮；改为无需模型的读取 |
| 参考人声清理与其环境准备 | SpeechService.cleanReference、driver.cleanReference | 第四轮（安装部分第五轮） |
| 乐谱生成 | JobManager.pump → render process | 第四轮 |
| 调速 | Studio.saveSpeed 持有 serial 锁、changeAudioSpeed 在主服务解码/计算 | 第四轮；转后台且不长期持锁 |
| 语音/YuE2 安装下载 | SpeechService.prepare、YuE2Engine.prepare 与运行时安装 | 第五轮 |
| 转换安装 | scripts/install-conversion-engine.mjs 导入本地二进制/权重 | 第五轮；不假定已有自动下载源 |
| 服务退出、worker stdin 关闭 | MusicService.close 与各 worker | 第二轮建立监管，后续逐路接入 |
| 大文件上传、播放器 Blob 缓存 | HTTP 输入、Studio audioUrl | 第四轮限制占用与回收 |

核对了本机固定 YuE2 源码：`create_app` 的 lifespan 启动 Worker；Worker 管理内部执行，模型状态不应由外层 HTTP 启动状态推断。第三轮必须关闭历史排队自动运行旁路，并持有执行权直到真实任务结束。

### 契约与兼容决定

- 各业务服务继续保存任务、版本与产物；协调器只持有执行权、临时预约和有界诊断历史。
- 内存采用字节；统一内存只有一个池，独立显存逐池检查。未知/过期指标和未知需求不准入，不使用开发机容量推断。
- 完整任务峰值与已驻留资源分开处理；复用模型只预约增量，主服务其他占用仍扣除。
- 新资源子状态投影到旧业务 queued/running/failed/cancelled/interrupted，不扩大旧顶层枚举造成历史解析失败；原因码独立保留。
- YuE2 的用户可见任务 ID 继续采用 32 位十六进制，本地生成稳定 ID 并保存上游 ID；历史 ID 原样保留。未发给上游也要可查询/取消，音频读取不能启动模型。
- 独立显存/其他平台只验证策略契约，未适配后端不得放行；数值策略由第六轮标定，本轮仅使用显式注入的测试参数。

### TDD、review 与验证

- 基线：服务 133 项、普通 28 项测试通过，构建通过。
- 预算策略六组行为测试先在“全部放行”的最小契约上失败，再实现容量、动态可用量、逐池限制、可信度与驻留扣减。
- 调度测试覆盖三引擎竞争、先卸载后切换、probe 期间取消、卸载失败封锁、容量拒绝、超时、队列上限、状态保存失败和空闲释放。
- Review 发现并以失败测试复现：排队取消等前任务完成、重复 close 提前返回；已修复。补充驻留查询异常封锁、关闭时尽可能清理所有适配器、空闲释放后的状态复核。
- 本轮核心测试 16 项、完整服务回归 149 项通过，TypeScript 检查与构建通过。日志：`/tmp/music-resources-r1-tests.log`、`/tmp/music-resources-r1-build.log`；临时日志不是长期验收档案。

第一轮完成不代表三个真实模型已经受保护；第二轮至第八轮继续执行。
