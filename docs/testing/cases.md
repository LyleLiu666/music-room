# 用例与状态覆盖

自动化以真实断言为准；本表为追溯索引，不另造一套“已通过”统计。P0 是丢数据、越界或错误成功；P1 是主要功能不可用；P2 是兼容与体验。文件路径相对仓库根目录。运行方式见[执行指南](running.md)，变更要求见[维护规则](maintenance.md)。

## 自动化用例

| ID / 优先级 | 前置条件与操作 | 必须观察到的结果 | 自动化位置 |
| --- | --- | --- | --- |
| DRAFT-01 / P0 | 同浏览器两窗口打开同一目录，分别编辑不同声音；旧窗口导航后刷新 | 两份草稿都保留；不能用整个旧快照覆盖新稿 | `src/workbench/studio/drafts.test.ts`、`scripts/verify-drafts-ui.test.mjs` |
| DRAFT-02 / P0 | 两窗口编辑同一声音，分别选择保留当前 / 使用已保存内容 | 冲突可见；选择前当前输入不丢失；选择后刷新符合决定；转换的升降调也适用 | 同上 |
| DRAFT-03 / P0 | 保存时模拟浏览器配额耗尽；继续编辑；恢复存储并重试 | 失败提示、输入保留、重试保存最新内容；不能假称成功 | 同上 |
| DRAFT-04 / P1 | 带旧版草稿进入页面，再出现较新的分声音记录 | 新记录优先；旧数据安全迁移，不原地改写传入的旧对象 | `drafts.test.ts` |
| DRAFT-05 / P1 | 只打开创作窗口，不输入任何内容，再刷新 | 默认草稿完成保存，不一直显示“正在保存”或误触发离开提醒 | `scripts/verify-drafts-ui.test.mjs` |
| SAVE-01 / P0 | 导入声音在写入文件后 / 索引提交后分别 SIGKILL | 提交前不出现可播放条目，孤立自有文件回收；提交后保留；同 requestId 重试只一条 | `src/service/studio/publication-crash.test.ts` |
| SAVE-02 / P0 | 导入乐谱在项目清单提交前 / 后 SIGKILL | 提交前清理未发布文件；提交后恢复到原声音；原版与成品不变 | 同上 |
| SAVE-03 / P0 | 混音项目清单已提交、声音记录尚未保存时 SIGKILL | 父版本、所属声音、混音参数与 requestId 保留；重试不重复创建 | 同上 |
| DELETE-01 / P0 | 写入永久删除意图后 SIGKILL；重启，尝试恢复，再重试删除 | 不假装恢复成功；删除可继续；再次重启不复活 | 同上，另见 `studio.test.ts` 中分层删除用例 |
| RETRY-01 / P0 | 实际 HTTP 保存成功后代理断开 TCP；重启；同请求并发重试 8 次 | 导入和混音各只一份；相同 ID 不同参数拒绝；原成品不变 | `src/server/lost-response.test.ts` |
| RETRY-02 / P0 | 调速已保存，浏览器收到失败，再点保存 | 复用 requestId；同一新版本；下载的速度和重新打开后播放速度正确 | `scripts/verify-speed-ui.test.mjs`、`src/service/studio/speed.test.ts` |
| RETRY-03 / P1 | 音乐失败后重试或从检查点恢复 | 原版本编号不变；旧尝试归档；参数、种子与检查点匹配；删除后不可复活 | `music-retry.test.ts`、`src/service/yue2/recovery.test.ts`、`verify-studio-ui.test.mjs` |
| MUSIC-PLAN-01 / P1 | 模型给出截断、无效或偏离所选目标时长的乐谱；成品音频提前结束 | 指定目标时乐谱与最终音频均须在 ±15% 范围内；规划最多三次，仍不达标报错且不合成；音频不达标保留诊断但任务失败；自定义谱不自动改写，自动时长不限制 | `src/service/yue2/duration.test.ts`、`duration_runtime_test.py`；真实失败保留在执行记录 |
| MUSIC-PLAN-02 / P1 | 使用原失败提示词、seed 42、fast、纯音乐、自动时长与自然收尾 | 首轮参数不变；失败后的采样恢复不改提示词 / 歌词，不增加输出预算；三次内写出完整乐谱并生成可播放音频。原始失败与后续结果分别留存 | `tests/quality/music-planning-regression.json`、`scripts/verify-music-planning-real.ts`、`duration_runtime_test.py` |
| UPGRADE-01 / P0 | 用提交 `c3a213395f31501d081f6269e2c6983796b4986b` 生成的真实旧格式目录，升级、关闭、再打开 | 原件哈希、父子关系、保留 / 成品选择、删除状态和反馈不变，无重复声音 | `src/service/projects/upgrade.test.ts`；样本见 `tests/fixtures/workspace-2026-10-10/` |
| BACKUP-01 / P0 | 升级前完整备份；升级后恢复某条旧记录；再用备份恢复到新目录 | 备份字节不变；恢复目录回到备份时状态，音频可读 | 同上 |
| QUOTA-01 / P0 | 北京时间 08:00 前预留，跨日收到回执；新日已有请求 | 不能从新日计数中扣旧日预约；新日增加已知用量 | `src/service/studio/lyrics-review.test.ts` |
| QUOTA-02 / P0 | 两个工作目录共用账号；第二轮超时；失败后重试；时钟回拨 / 计数损坏 | 账号计数共用；缓存命中的轮次不重复收费；未知用量保留预约；异常计数禁止请求 | 同上 |
| LYRICS-01 / P1 | 识别有重复、漏唱、新增、改词，模型核对不一致 / 格式错误 / 取消；Cloudflare 优先、额度不足切换 OpenAI 备用接口、两轮重新核对、缓存与额度隔离 | 不把参考词当实际演唱；不确定结果保留待核对；失败不覆盖旧稿 | `lyrics-review.test.ts`、`lyrics-generation.test.ts`、`scripts/test-lyrics-worker.py`、`scripts/experiments/*test*` |
| MEDIA-01 / P0 | WAV 8 / 44.1 / 48 / 96 kHz，1 / 2 声道，整数 8/16/24/32 与浮点 32/64；单帧、600 秒、600 秒多一帧 | 合法组合通过；超边界拒绝；内存估计随速度正确变化 | `src/service/studio/audio-budget.test.ts` |
| MEDIA-02 / P0 | 截断头部、容器长度矛盾、字节率错误、缺填充、尾部碎片、固定随机种子损坏 500 次 | 返回受控错误，无底层解析异常或超额分配 | 同上 |
| MEDIA-03 / P0 | FLAC 缺帧、哈希不符、扩展名欺骗、超上传大小、路径越界 / 链接 | 不提交记录、不读写外部文件、不出现可下载的伪成功音频 | `sound-library.test.ts`、`audio-files.test.ts`、`src/server/resource-io.test.ts`、`http.test.ts` |
| RESOURCE-01 / P0 | 低内存、系统压力、磁盘不足、资源设置损坏、并发重型引擎 | 排队或受控失败；禁止越过保护；同一时刻不重复加载冲突引擎 | `src/service/resources/*.test.ts`、`src/service/conversion/engine-exclusion.test.ts` |
| RESOURCE-02 / P0 | 登记进程组及普通工作进程；采样前退出成僵尸；存活进程采样拒绝或进程表异常 | 覆盖所有登记进程、排除无关组；仅确认退出后归零；存活或状态未知时继续受控失败 | `src/service/resources/telemetry.test.ts`、`native-telemetry.test.ts` |
| SERVICE-01 / P0 | 关闭启动终端 / MCP 连接、并发启动、端口复用、关闭所属进程 | 后台工作不中断；只有一个所有者；不杀无关进程；重启中断状态可追踪 | `src/server/background.test.ts`、`mcp.test.ts`、`src/service/yue2/worker.test.ts` |
| UI-01 / P1 | 播放时导航、重试别的版本、删除失败、断网重连、旧播放请求晚返回 | 原音频连续；只在删除所属音频时停止；过期响应不抢占播放器 | `scripts/verify-*-playback-ui.test.mjs`、`verify-audio-loading-ui.test.mjs` |
| UI-02 / P1 | 用键盘打开对话框、Tab / Shift+Tab、轮询更新后 Escape；展开高级输入 | 背景控件不可聚焦；Escape 返回打开控件；可见输入有名称 | `scripts/verify-browser-compat.test.mjs` |
| UI-03 / P2 | Chrome / WebKit，390px 窄屏，播放与原文件下载，刷新草稿 | 无横向溢出，真实点击后能播放，下载字节一致；独立记录浏览器结果 | 同上、`verify-drafts-ui.test.mjs` |
| UI-04 / P1 | 草稿保存失败，刷新触发离开提醒，选择留在当前页面 | 输入仍可编辑；已有音频 URL 仍能重新读取；实际离开页面后才释放媒体资源 | `scripts/verify-browser-compat.test.mjs` |
| UI-05 / P2 | Chrome / WebKit，1280×720 与 900×600 小窗口，19 个项目、长名称，展开资源详情再恢复大窗口 | 搜索与新建同排；项目按可用高度分页，每页完整显示且无内部纵向滚动；所有项目可翻页找到；搜索、新建和设置可用；大窗口恢复每页 6 项 | `scripts/verify-task-history-ui.test.mjs` |
| LIBRARY-01 / P1 | 10,000 条声音、长创作要求，跨页搜索 / 分类 / 排序与播放顺序查询 | 接口仅返回当前页 20 / 50 条；工作台不传整库声音及历史版本正文；播放 ID 顺序覆盖全部页 | `src/service/studio/sound-catalog.test.ts` |
| LIBRARY-02 / P2 | Chrome / WebKit，1280×800、900×700、720×456 和 390×844；深浅主题及实际 200% 缩放 | 宽窗口顶部至首条声音不超过 140px、完整显示至少 8 条；声音行高不超过 64px；窄窗口控件可见且无横向溢出；手机滚到声音库后检查列表密度 | `scripts/verify-listening-queue-ui.test.mjs`、`verify-zoom-ui.mjs` |
| PLAYLIST-01 / P1 | 保存具体版本、重复添加、并发旧修订覆盖、取消收录、来源删除、服务重启及删除列表 | 顺序持久化；重复 ID 去重；旧修改拒绝覆盖；相同成功请求可恢复；失效条目保留；原音频不受删表影响 | 同上、`scripts/verify-binary.mjs` |
| PLAYBACK-QUEUE-01 / P1 | Chrome / WebKit，45 首跨页连续播放、搜索 / 导航、快速切歌、404 / 503、拖动后立刻刷新、390px | 仅按需读取当前音频；过期读取不抢播；明确缺失跳过、服务故障暂停；队列与进度可恢复但不自动播放；无横向溢出 | `scripts/verify-listening-queue-ui.test.mjs`、`verify-sound-library-ui.test.mjs` |
| PLAYBACK-SHUFFLE-01 / P1 | 45 首跨页随机播放、播放列表及筛选、自动顺延、前后切歌、删除 / 追加 / 指定下一首、刷新、切回顺序；空 / 单首 / 20,000 首 | 一轮不重复不遗漏，末尾停止；前后切歌沿随机顺序；刷新保持原随机顺序与暂停进度；切方式不重载当前音频；保存列表不变；随机及顺序入口保持紧凑布局 | `src/workbench/studio/listening-order.test.ts`、`scripts/verify-listening-queue-ui.test.mjs` |
| SCALE-01 / P1 | 2,000–20,000 固定版本，多项目分页；40 次暂停、取消、生成、删除恢复；每 10 次重启 | 无重复 ID、分页越界、遗留队列；原文件不变；统计 p50 / p95 / RSS | `scripts/verify-soak.mjs` |
| HARNESS-01 / P0 | 新增不同命名或新目录的测试；从日常命令移除现有套件 | 漏项检查失败；每个脚本测试须接入入口或有明确历史原因，独立试验台单列 | `tests/verification-gate.test.ts` |
| HARNESS-02 / P0 | 续跑时音频损坏、日志缺失、输入 / 种子 / 速率 / 模型变化；旧尝试失败 | 不复用失效成功，不覆盖原证据；失败尝试可重跑，历史失败与人工待评状态保留 | `tests/quality-resume.test.ts`、`quality-execution.test.ts`、`quality-evidence.test.ts` |

## 状态转换

| 状态 / 触发 | 合法结果 | 必须拒绝或保留的不变量 |
| --- | --- | --- |
| 等待 → 资源准入 | 运行 | 暂停时不能开始；新任务不能绕过等待顺序 |
| 等待 / 运行 → 取消 | 取消，释放自己占用的资源 | 不发布部分音频；不影响其他工作目录 |
| 运行 → 完成 | 验证文件后发布成功 | 文件缺失、哈希错误、时间线不完整不能算成功 |
| 运行 → 进程退出 | 下次打开为中断，或恢复已提交结果 | 不能永久显示运行；不能重复创建版本 |
| 失败 / 取消 / 中断 → 音乐重试 | 原版本新尝试；历史尝试保留 | 不覆盖历史输入，不复用失败规划的种子窗口 |
| 成功 → 调速 / 混音 / 转换 | 新子版本 | 原件、原成品选择不变 |
| 活跃 → 回收站 → 恢复 | 恢复到原层级，历史决定按约定保留 | 活跃任务尚未结束时不允许删除 |
| 回收站 → 永久删除中 → 已删除 | 每个文件的删除可重试，完成后不复活 | 删除中不能恢复或当作正常音频使用 |
| 歌词旧稿 → 新任务 → 核对失败 | 旧稿保持可见，新任务明确失败 | 不覆盖旧稿、不自动切付费模型、不编造同步时间 |

## 必须人工或真实环境执行的用例

以下不是自动化通过项。执行人填实际结果、时间、产物与缺陷链接。

| ID | 前置条件 | 操作 | 验收结果与证据 |
| --- | --- | --- | --- |
| REAL-01 | 隔离目录、已安装模型，记录空闲内存和磁盘 | 分别生成 TTS、YuE2 两档、人声转换；再混合排队、取消并重启 | 真实音频非静音且可播放；峰值、资源释放、错误和耗时留档；保护不能被测试关闭 |
| REAL-02 | 独立包已构建，普通用户账号 | 隐藏 dist，PATH 仅系统命令；开启 MCP，渲染、下载、重开 | 所有资源来自包；本机模型与系统组件要求按使用文档执行；不要求源码和 Node |
| REAL-03 | 有足够磁盘的受控测试卷 | 安装 / 下载 / 保存时逐步耗尽空间，然后释放空间重试 | 不把部分安装标成就绪；已有模型和产物不损坏；不默认在用户磁盘造满盘 |
| REAL-04 | 保存了声音的隔离目录 | 锁屏、睡眠、唤醒；网络断开再恢复；关闭所有网页再打开 | 后台状态可恢复，音频仍可读；失败说明明确，不假显示完成 |
| UI-ZOOM-01 | 200% 浏览器缩放，深浅主题 | 新建、创作、版本菜单、回收站、下载、声音库 | 无重要控件遮挡；正文可读；状态不只靠颜色；保留截图 |
| SOAK-01 | 固定机器，隔离目录 | 至少 60 分钟连续循环，另做真实模型混合任务 | 记录真实持续时间、任务数、RSS / 系统压力、p95；短测不等价于长稳 |
| QUALITY-01 | 固定语料已准备，真实模型完成 | 按固定样本逐条听评，实际唱词独立转写 | 见[质量标准](quality.md)；任何未评分项维持待验收 |

HTTP 新建操作的契约区别：带 `requestId` 的保存 / 转换等操作可以重放同一请求；显式 `studio_generate` 每次是一次新创作。生成响应不明时先刷新任务和版本，不自动重发“创建”来假装实现了幂等。

## AI 编曲入口

| ID | 场景与预期 | 自动化位置 |
| --- | --- | --- |
| MUSIC-AGENT-01 | 主创作表单复制当前风格与时长给 Agent，不自动提交；要求走完整 ABC → YuE2，短样非必经；工作区优先展示编曲入口，MIDI 工具可展开 | `scripts/verify-music-input-ui.test.mjs` |
| MUSIC-AGENT-02 | 当前版本作为父版而非它的旧父版；保留种子 0、明确档位、收尾及乐谱；纯音乐不夹带隐藏歌词，演唱保留完整歌词，不读取失败来源的乐谱 | `src/workbench/studio/music-agent.test.ts` |
| MUSIC-AGENT-03 | 新 MCP 客户端从连接说明发现手册，生成工具指向只读指南；工具与资源返回一致内容及谱例，明确改谱不保证减少重复，不强制 Agent 作曲；读取不创建项目、不启动任务，拒绝额外生成参数 | `src/server/mcp.test.ts` 中 MCP onboarding |

## Breeze 与 IndexTTS 兼容

| 场景 | 核心断言 | 自动化位置 |
| --- | --- | --- |
| TTS-BREEZE-01 | 完整参考文字稿选择 Breeze；省略或空白选择 IndexTTS；失败不改换模型；版本保留文字稿与实际引擎 | `src/service/tts/compatibility.test.ts` |
| TTS-BREEZE-02 | 固定程序与模型、正文和参考边界匹配才允许 5 GB 预约；修改身份或越界不放行 | `src/service/resources/profiles.test.ts` |
| TTS-BREEZE-03 | 文字稿草稿和再创作可恢复；换音色清空旧稿；小屏幕保持可提交 | `scripts/verify-emotion-strength-ui.test.mjs`、`scripts/verify-studio-conversion-ui.test.mjs` |
| TTS-BREEZE-04 | 真实流式短句、分段长文、长参考资源边界、IndexTTS 兼容及取消不发布半成品 | `scripts/verify-breeze-real.ts` |
