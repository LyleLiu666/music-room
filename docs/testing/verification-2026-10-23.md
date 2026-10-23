# 2026-10-23 测试执行记录

## 本次结论

Chrome 自动化界面回归、WebKit 兼容、原生 Safari、受控满盘、整机断网恢复、实际睡眠 / 唤醒和 200% 页面缩放已通过。安装回退、语音磁盘保护、缩放遮挡及整库复制的内存开销已修复。真实模型继续暴露运行监测读取全局进程表的问题，现改为只查询已登记的工作进程及其模型进程组；相关原生回归通过，服务全量 342 / 342，0 跳过。

一小时流程长稳已通过：连续操作 3,600.294 秒，2,462 轮，246 次同一服务进程关闭重开；列表 p95 为 107.3 ms。驱动为确定性模型替身，不代表真实混合模型长稳。真实模型固定语料 20 / 20 已完成：9 个语音、3 档变速、6 个音乐和 2 个转换样本。同步歌词、6 项资源校准、固定语料混合队列、真实 TTS 界面及独立包真实音乐均完成复验。

自动化与真实环境的既定执行项已完成，质量验收仍未完成：人工听评和歌词独立真值尚未填写；一个自由创作提示词连续三次达到规划上限，保留为未解决的模型质量问题。换用固定语料通过队列测试，不证明该提示词的问题已修复。历史失败、执行者中断与成功复验分别留档。

环境：macOS 27.0.1，Apple M4 / arm64，32 GiB，Node 25.3.0，Bun 1.4.2；Chrome 155.0.8059.85，Playwright WebKit 27.2。日期按 Asia/Shanghai，JSON 采用 UTC。基线提交 `810d523`，修改未提交；文件指纹见证据清单。运行期间整机负载曾达约 69，耗时仅代表本次机器条件。

## 自动化回归

| 范围 | 结果 | 最新证据 |
| --- | --- | --- |
| 单元测试 | 89 / 89，0 跳过；覆盖任务等待、唤醒超时、测试漏项、续跑完整性和歌词独立选跑 | `test-results/qa-2026-10-23/system/unit-maintenance-final.log` |
| 服务 / HTTP / MCP | 进程采样修复后 342 / 342，0 跳过；此前磁盘不足的失败记录保留 | 同目录 `service-exiting-worker-final.log`、`service-space-recovered-green.log`、`service-memory-fix-low-disk-failed.log` |
| Chrome 工作台 | 64 / 64，0 跳过；含短视口“设置”点击回归及每项 90 秒超时 | 同目录 `studio-final.log` |
| Chrome 乐谱 / 歌词 / 资源 | 3 / 3，0 跳过 | 同目录 `ui-remaining-final.log` |
| WebKit 兼容 | 7 / 7，0 跳过；含短视口“设置”点击回归 | 同目录 `webkit-final.log` |
| 独立可执行包 | 16 项通过，错误为空；隐藏松散资源、无 Node/Bun PATH | 同目录 `binary-exiting-worker-final.log` |
| Python 歌词 worker | 12 / 12 | 同目录 `verify-all-before-zoom.log` |
| 歌词实验规则 | Python 14、Node 8，全部通过 | 同上 |
| 独立 YuE2 试验台 | Python 11、Node / 浏览器 6，全部通过；本轮产品改动未涉及该试验台 | `test-results/qa-2026-10-23/trials.log` |
| 构建与静态检查 | TypeScript、Vite、原生辅助程序、Bun 独立包及差异格式检查通过 | 同目录 `binary-exiting-worker-build-final.log`、`types-maintenance-final.log` |

当前服务用例总数为 342，最新全量已覆盖全部用例，包括目标进程及组选择、空组与采样故障区分、真实 BSD 进程组隔离及退出采样竞态。

日常回归已完整执行；产品修复后的服务、Chrome、WebKit 和独立包分别完成相关全量复验。测试维护加固后的单元测试为 89 项。通过数来自上表日志；旧失败与较早的通过记录保留在证据目录，不累加为当前结果。构建及隐藏 `dist/` 的独立包验证与浏览器测试顺序执行。

## 系统级结果与范围

| 场景 | 实际执行与结果 | 证据 |
| --- | --- | --- |
| 安装 / 保存满盘 | 脚本创建 64 MiB RAM 卷，6 项通过：低空间预检、已安装 TTS 的生成前磁盘拒绝、真实 ENOSPC 保存、释放空间后的保存与重开、下载流中途满盘保留旧安装、下载重试只发布完整文件。下载器使用 32 MiB 测试权重 | `test-results/system-disk/verification.json` |
| 断网 / 重连 | Chrome 测试上下文真实离线，提交不产生虚假后台任务；输入保留，联网与刷新后恢复 | `test-results/system-lifecycle/verification.json` |
| 关闭所有测试页 | 后台服务持续存在，重新打开后真实 TTS 音频字节不变 | 同上 |
| 服务挂起 / 恢复 | 对隔离服务执行 SIGSTOP / SIGCONT；挂起时请求确实超时，恢复后状态和音频一致 | 同上；此项不等同于 macOS 睡眠 |
| 200% 页面缩放 | 独立 Chrome 配置启用真实缩放，DPR=2、1440 物理宽度对应 720 CSS 宽度。深浅主题的新建入口、创作、菜单、设置、下载和回收站恢复通过，12 张截图已核查 | `test-results/zoom-ui/verification.json` |
| 原生 Safari | Safari 27.0.1 原生 WebDriver，5 项通过：键盘弹窗与焦点返回、Unicode 草稿刷新恢复、真实 WAV 播放、短窗口设置入口、390 px 侧栏与工作区上下排布。截图已核查；不宣称原生下载通过 | `test-results/safari-native/verification.json`、`desktop.png`、`narrow.png` |
| 整机断网 / 重连 | 真实关闭默认路由的 Wi-Fi，外网请求失败，本机服务和真实语音仍可读取；重新联网后外网与音频哈希恢复一致 | `test-results/host-network/verification.json` |
| 实际睡眠 / 唤醒 | 10:33 合盖睡眠，11:14:58 用户唤醒；跨越 2,518 秒，其中 6 段实际睡眠共 2,469 秒、5 次维护唤醒。恢复后原语音哈希一致，运行中的长语音曾恢复至第 4 / 9 段；该部分样本随后由执行者停止以修复脚本，不计生成完成 | `test-results/host-sleep/verification.json`、`system/host-sleep-os-events.log` |

## 真实模型与固定语料

| 范围 | 实际结果 | 证据 |
| --- | --- | --- |
| 六项真实资源校准 | 语音、短 / 长参考清理、转换、音乐快档与质量档均完成并释放资源。原生采样峰值依次为 4.34、7.08、7.23、2.55、5.60、5.45 GiB；6 / 8 / 10 / 14 GiB 是校准限额，不是实测值 | `test-results/resources-real/run-1792699751468/verification.json` |
| Q-TTS-01 / Q-TTS-02，各 seed 42、43、44 | 6 次真实生成成功；分别覆盖普通中文、数字与中英文混读，波形有限且非静音。人工听评仍待完成 | `test-results/quality/real/execution.json` 与对应 WAV / 日志 |
| Q-MUSIC-01 三个种子 | 3 次真实生成成功，223.20、213.48、57.44 秒；目标 60 秒为现有产品的编曲软约束，保留实际偏差，不声称时长准确 | 同目录 `execution.json` 与对应 FLAC / 日志 |
| Q-MUSIC-02 | 三次成功，53.80、57.60、59.96 秒 | 同上 |
| Q-SPEED-01 三档保存 | 正式处理器完成 0.5、0.8、2.0 倍 WAV；哈希一致、无削波、时长误差不超过一个输出采样点。工作台保存流程另有 UI 回归 | 同目录 `speed-timing.json` |
| 固定生成总计 | 20 / 20；包括 3 个完整长文本，时长 255.16、252.37、255.23 秒。历史磁盘拒绝、采样失败、压力保护与中断均保留 | 同目录 `execution.json`，按每个试验的最新记录统计 |
| 真实资源独立包 | 7 项通过：冷启动、3 GiB 拒绝、暂停恢复、运行中取消、SIGKILL 后代进程清理、重启重试与正常关闭 | `test-results/resources-real/binary-1792732896072/verification.json` |
| 真实 TTS 界面与默认情绪 | 14 项通过；真实生成、下载 / 播放、成品 / 草稿恢复、默认情绪、版本关系、双音频比较与取消。截图已核查 | `test-results/speech-real/verification.json` |
| 真实混合队列 | 正式资源策略下，语音、转换和音乐依次完成；等待任务取消后无音频、不占执行位，10 个自有工作进程退出，队列与常驻模型清空。音乐使用固定语料 Q-MUSIC-01；原自由创作失败单独保留 | `test-results/mixed-real/run-1792734932899/verification.json` |
| 真实音乐独立包 | 7 项通过：正式 MCP 连接、推理期间真实 MLX / 模型身份、器乐适配器、完整生成、有限且非静音 FLAC、鉴权下载字节一致、Chrome 播放。音频 80.28 秒，截图已核查 | `test-results/yue2-real/verification.json`、`generated.png` |
| Q-LYRICS-01 | 已用 Q-MUSIC-02 真实歌曲完成 ASR、审校及对齐，保存 6 句同步草稿；直接工作进程采样修复后的真实复验通过，峰值 3,832,154,032 字节。人工唱词和时间真值未填写 | `test-results/quality/real/execution.json` |
| 主观听评 | 四项评分、人工转写与时间真值均待完成；客观波形指标不替代听评。最终独立核验通过：5 份输入、20 个产物及日志、6 句歌词的源音频关联和 58 个歌词模型文件 | `test-results/quality/real/identity-verification-final.json`；`review-ready.json` 已关联全部产物，质量门禁仅因 47 项人工字段未完成而拒绝，见 `system/quality-pending-validation.json` |

系统盘曾由约 2.4 GiB 降到不足 128 MiB；用户释放后恢复到约 98 GiB，真实模型已继续。本轮大模型验收要求至少 10 GiB 可用空间；变速组使用自身正常预算。隔离模型通过强制 APFS 克隆准备，测试数据均在独立目录。实际睡眠暴露验收脚本误用墙上时间及超时未收妥任务的问题，已改用 macOS 清醒运行时间，读取终态优先于超时，并在异常时等待取消；4 项单元回归及原生时钟检查通过。

最终独立包 SHA-256 为 `ff99aa1a537e20cd2f955f7435ef61a860ecd6b144481fc6f4e16fcffd3bb72d`。真实资源与音乐验证使用同一份包；测试结束后关闭自有后台服务，释放模型进程与临时防休眠。全部文件、日志和报告的指纹见[本地证据清单](../../test-results/qa-2026-10-23/manifest.json)。

## 持续运行与规模

本轮 60 分钟长稳包含真实 HTTP、磁盘持久化、队列、取消、生成、成品选择、删除恢复、分页及每 10 轮服务关闭重开。模型驱动为确定性替身；真实混合模型负载另验。服务与压测客户端已分为独立进程，服务关闭重开保持相同 PID；服务 RSS 继续执行预热后增长小于 256 MiB 的原门禁，客户端内存单列；每轮内存采样前主动 GC，最高采样值不等于生产瞬时峰值。报告记录实际操作时长、源文件哈希、堆与外部缓冲区、系统压力、交换空间和磁盘抽样。测试进程运行期间使用临时防休眠断言，进程退出后自动释放。

本轮从 `2026-10-22T22:42:23.512Z` 连续操作至 `2026-10-22T23:42:23.806Z`，实际 3,600.294 秒，2,462 轮、246 次同进程服务重开，退出码 0。服务预热后 RSS 为 171.1 MiB，最高采样 391.8 MiB，增幅 220.6 MiB，低于原 256 MiB 门禁；客户端最高采样 143.8 MiB。列表 p50 / p95 / 最大为 58.7 / 107.3 / 134.7 ms。42 次硬件抽样均为正常压力，无采样错误；被测五个源文件哈希始终一致。服务、客户端和临时防休眠均正常退出。证据为 `test-results/soak/verification.json`、`system/soak-memory-fix-hour.json`、`soak-memory-fix-hour.log`、`command-exits.json`、`completion-exits.json`。原生采样器预验证 70 轮通过，记录为 `test-results/qa-2026-10-23/system/soak-native-sampler-short.json`。

内存复制修复后的容量回归：

| 固定历史版本 | 操作轮数 / 服务重开 | 列表 p50 / p95 | 结果 |
| --- | --- | --- | --- |
| 2,000 | 1,800 / 180 | 44.4 / 79.8 ms | 通过，650.5 秒 |
| 2,000 | 3,000 / 300 | 68.5 / 138.6 ms | 通过，1,645.4 秒；服务最高采样约 414 MiB，预热约 181 MiB |
| 20,000 | 40 / 4 | 144.1 / 160.2 ms | 通过，18.2 秒 |

证据为 `system/soak-memory-fix-1800.json`、`soak-memory-fix-3000.json`、`soak-memory-fix-20000-40.json`。固定历史量之外，操作轮数会新增同等数量的语音版本，末轮总数也纳入断言。这些运行不代替完整一小时，也不能外推真实模型吞吐量。早期短测保留在上一级证据目录，其 RSS 混合了客户端，机器负载也不同，不直接比较性能倍数。

## 修复与失败证据

- 多窗口草稿按声音保存并检测冲突；存储失败保留输入和重试；初始草稿能结束保存。歌词额度跨日结算不抵消新日其他请求。
- 乐谱 / 混音发布前持久化归属和请求身份；SIGKILL 后恢复版本、父子关系和重试身份。旧工作目录升级、原件、备份恢复及真实网络丢响应有回归。
- WAV 拒绝字节率不一致、填充缺失与不完整尾部；补齐格式、边界和损坏输入。取消离开时音频仍可使用；弹窗焦点与字段名称有回归。
- 原生安装在新模型下载并校验后才替换可用程序；503 与真实下载 ENOSPC 均验证旧安装保持就绪。
- 语音生成在模型加载前检查工作目录，预算包含最大 256 MiB 输出和 2 GiB 储备；空间释放后显式重试成功。
- 200% 缩放的固定底栏原先挡住“设置”；侧栏滚动区现已留出空间，并将点击断言接入 Chrome / WebKit 日常门禁。
- 声音库和语音记录使用普通数据复制，避免每个事务都经过原生整库序列化；仍保留回滚需要的 undefined 字段。二进制音频等原生叶节点保留原生复制方式，调用者修改返回值不影响原件。新增真实接口类型回归及复制隔离断言。
- 服务测试每项超时 60 秒；两个只验证资源释放的测试显式固定磁盘条件，避免任务未启动时无限等待释放阶段。
- 运行监测只查询已登记的工作进程及其模型进程组，避免其他程序的进程变化污染采样；目标组格式异常、权限不足或重试后超时仍受控停止，未降低保护。真实 BSD 子进程组隔离、直接工作进程与故障回归已覆盖；采样失败后重新核对退出 / 僵尸状态，避免进程收尾被误判为运行监测故障。
- 模型克隆不再允许静默退回全量复制；长稳采样改用产品相同的原生计数器，采样失败保留记录并仅作一次有界重试。浏览器门禁每项超时 90 秒。质量执行汇总按每次试验的最新结果判断，保留旧失败且不把部分范围冒充全量通过。

失败与复验分开保留，下表不计入当前通过数。证据路径相对 `test-results/qa-2026-10-23/system/`。

| 失败 / 中断 | 判断与处理 | 证据 |
| --- | --- | --- |
| 长稳第 377 轮遇到 ENOSPC | 真实系统盘空间不足；保留保护，释放空间后完整重新计时 | `soak-disk-full-failed.json` |
| 长稳第 1,022 轮 `vmmap` 采样超时 | 执行器采样问题；改用产品原生计数器，最终一小时通过 | `soak-vmmap-timeout-failed.json` |
| 长稳第 1,282 轮外部诊断触发模块加载错误 | 执行者操作中断，不归为产品缺陷，不计一小时通过 | 早期执行日志与 `verification-before-organization.md` |
| 混合服务 / 客户端 RSS 在 1,754 轮超限 | 不能单独证明服务泄漏；拆成两个进程后重新测量 | `soak-combined-rss-failed.json` |
| 隔离后 1,217 轮仍超限；仅改比较方式在 1,232 轮仍超限 | 固定记录读写对照稳定；最终修复普通记录复制，同时保留原生二进制叶节点，容量与一小时验证通过 | `soak-isolated-accelerated-rss-failed.json`、`soak-deep-equal-failed.json`、`fixed-read-control.json`、`fixed-write-control.json` |
| 内存复制初版 1,800 轮通过但缺少二进制支持 | 仅为对照，不纳入最终结果；正式版另行验证 | `experiment-disposition.json`、最终 `soak-memory-fix-1800.json` |
| 修复前另一轮长稳在约 22 分钟主动停止 | 为应用修复而中断；后续重新完整计时 | `soak-isolated-before-memory-fix-interruption.json` |
| 浏览器播放 Promise 挂起 | 保留首次日志，增加每项 90 秒上限；隔离复跑及 Chrome 全套通过 | 浏览器失败日志与 `studio-final.log` |
| 并行构建导致原生头文件缺失 | 执行者同时改动同一构建目录；改为顺序构建后服务全量通过 | `service-direct-worker-build-race-failed.log` |
| 真实模型期间独立包渲染被资源租约拒绝 | 全机资源保护按设计生效；模型空闲后独立包 16 项通过 | `binary-direct-worker-lease-contention-failed.log`、`binary-exiting-worker-final.log` |
| 最后一个长文本被内存压力 / 交换写出保护终止 | 保留两次失败；资源恢复后同参数补跑成功，未降低保护 | 固定语料 `execution.json` 与 `quality-long-retry.log` |
| 混合队列的自由创作输入连续三次规划达到 4,096 token 上限 | 明确失败并释放资源，未发布残缺音频；这是保留的模型质量限制。队列回归改为直接使用固定语料 Q-MUSIC-01，不能据此声称原提示词已修复 | `mixed-planning-failure/`、原始 `mixed-space-recovered.log` |
| 真实 TTS 默认配置生成成功后比较控件定位超时 | 脚本仍用旧选择器；改为当前版本选择与声音导航，明确选择新生成版本并要求两份比较音频。定向界面与真实完整流程复验通过 | `tts-default-space-recovered.log`、`tts-current-ui-regression.log` |
| 独立包真实音乐生成完成后找不到引擎 URL | 产品按设计自动卸载模型；脚本改为推理期间核验真实引擎身份，完成后检查保存音频与播放 | `yue2-binary-space-recovered.log` |
| 独立包音乐完成推理及下载后，声音定位匹配两个控件 | 同一声音也在隐藏的溢出菜单中；脚本按可见标签 / 溢出菜单定位，导航回归和第三次完整真实推理、下载、播放复验均通过 | `yue2-binary-space-recovered-final-regression.log`、`sound-overflow-ui-regression.log`、`yue2-binary-final-selector-regression.log` |
| 资源校准的音乐阶段 `vmmap` 采样失败 | 脚本改用产品同款原生采样器；18 项采样回归及 6 项完整校准复跑通过，校准限额未变 | `resources-vmmap-failed.json`、`calibration-native-regression.log` |

安装、磁盘预检、缩放、等待和续跑的先失败记录分别为 `native-install-red.log`、`tts-disk-red.log`、`zoom-native-red.log`、`zoom-layout-red.log`、`browser-timeout-red.log`、`quality-resume-red.log`。早期草稿、发布、媒体和取消离开等失败记录保存在上一级证据目录。

## 测试维护加固

测试入口、执行指南、用例索引、质量标准与维护规则分开维护，README 与根目录 AGENTS 指向统一入口。日常门禁检查所有脚本测试和 TypeScript 测试的注册情况，历史页面与兼容别名单列；不同命名与新目录不能悄悄漏跑。实际临时加入未注册套件时检查失败，移除后恢复通过。

真实语料续跑先核对输入指纹、模型记录、请求 / 种子 / 速率与已有音频，日志必须非空，新记录另校验日志哈希。音频损坏、模型变化、请求变化和缺失日志的 4 次脚本级故障注入均在启动模型前拒绝，旧执行记录字节不变；19 个已有真实产物的校验及普通语音组成功续跑通过。歌词单独验收的退出状态已修复；空范围和未完成范围仍不能通过。

证据为 `system/maintenance-gates-red.log`、`maintenance-gates-green.log`、`quality-preflight-verification.json`、`quality-resume-integration.log`、`lyrics-only-selection-red.log`、`lyrics-only-selection-green.log`。维护改动只涉及测试执行与文档，不改变已通过长稳及独立包所测的产品逻辑。
