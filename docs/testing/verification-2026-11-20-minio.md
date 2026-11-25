# 2026-11-20 YuE2 成品归档验收

## 审阅范围

改动位于 Music Room 的 `redesign/quiet-letter` 工作区，基线为 `433e302f51dab226dc722397a7aabe196a8bd8a9`。开工前已有七个文件带未提交改动，完整补丁保存在 `/Users/liu_y/.codex/music-before-minio.I5uY277Y/working-tree.patch`，SHA-256 为 `ce7aba21cf66c0737f65e5a9dabf98076e3f3c5934d20e137bf1b61aaecd3ddf`。已验证该补丁可以与本次改动一并应用。此次代码留在工作区供审阅。

- 新生成的 YuE2 FLAC 可后台归档。上传读回核验 SHA-256，失败时原件可用，待归档状态可跨重启重试。
- 旧版本逐首试迁。默认保留本机原件。明确启用手动释放后，仍会核对远端和本机内容再移除原件。恢复后的旧版本可从同一私有桶读取音频、导出 MP3，并继续使用本地乐谱。
- 主播放器、两版对比使用同一解析入口，声音库队列也可直接播放签名地址。回收站保留对象，彻底删除时删除对象和本机文件；失败可重试。
- 配置、试迁、释放与回退见[本机服务](../local-service.md#yue2-成品归档到-minio)。

## 验证结果

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 前端与测试入口 | `npm test` 126 项通过 | [日志](../../test-results/minio-2026-11-20/npm-test-final.log) |
| 服务回归 | 432 项通过 | [日志](../../test-results/minio-2026-11-20/service-final-code.log) |
| 源码构建 | TypeScript 和 Vite 构建通过 | [日志](../../test-results/minio-2026-11-20/build-final.log) |
| 既有播放与声音库、首次使用界面 | Chrome 12 项播放及声音库、4 项首次使用通过 | [播放与声音库](../../test-results/minio-2026-11-20/browser-regression.log) · [首次使用](../../test-results/minio-2026-11-20/backup-ui.log) |
| 隔离 MinIO 和 Chrome | 源码服务与独立包均通过。覆盖私有访问、签名 Range 206、主播放器和声音库拖动／播放、MP3、乐谱、工作区备份恢复、回收站与彻底删除 | [源码服务](../../test-results/minio-2026-11-20/isolated-minio-final.log) · [独立包](../../test-results/minio-2026-11-20/binary-minio.log) |

独立包使用项目固定的 Bun 1.4.2 构建到测试目录，SHA-256 为 `e302e91d9441f8c0de26d15f438c2dc51e9e5432a4edeb15e231ab6a16f19f88`。初次回归先在基线上确认归档接口缺失。集成测试首跑定位器超时后改为按项目 ID 执行。原生辅助程序构建和服务测试的前置构建同时写入同一目录曾导致构建失败，串行复跑通过。独立包首次命中全局 Bun 1.3.12，改用仓库依赖内的固定 Bun 后通过。

## 初版代码验收的现网边界

首次代码验收时，106 现有 HTTPS 域名经 104 的 EasyTier 地址返回健康检查 `200`。首次代码验收未部署、创建现网桶或上传作品。上线前仍需用专用私有桶在实际浏览器验证 EasyTier 路由、几十 MiB 的上传、HTTPS 签名和 Range 并完成异机副本恢复演练。已有本机作品音频和试验目录均未迁移或清理。

## 日常启动与现网上线

合回开工前的固定端口补丁。新版本的默认工作区仍在 57923，隔离工作区可以使用临时端口。安装新包前保留了原二进制、启动器和回执。冷启动后确认原有 8 个项目 ID 一致，直接运行二进制会复用同一后台。

配置从工作区外的私有 JSON 自动加载。测试覆盖缺省、其他工作区隔离、拒绝不安全的文件权限及符号链接。源码与独立安装包测试在无 MinIO 环境变量时读取配置，经过重启与恢复到隔离工作区，再访问实际 S3 兼容服务。新一轮完整服务回归 434 项通过。首轮有两条语音用例超时，定向 20 项与随后完整复跑均通过。

106 私有桶和独立账号已启用。实测账号不能列桶，未签名读取返回 403。合成 FLAC 的 47,644,934 字节经 104 域名上传并读回校验，签名分段返回 206。Chrome 播放并定位到第 87 秒。代理控制面确认 `minio.strategylab.xyz:10003` 直连 `10.144.144.104`。两首旧歌已用安装版试迁并保留原件，浏览器试听、拖动及 MP3 导出均通过。

- [全量服务复跑](../../test-results/minio-2026-11-20/service-onboarding-final.log)
- [独立安装包冷启动与配置](../../test-results/minio-2026-11-20/binary-private-config-integration.log)
- [真实网关](../../test-results/minio-2026-11-20/real-gateway.log)
- [安装记录](../../test-results/minio-2026-11-20/deploy-live.log)
- [正式工作区试迁](../../test-results/minio-2026-11-20/trial-live.log)


## 存量迁移与磁盘释放

- 现有 109 个 FLAC 及对应索引、乐谱和任务资料进入 104 独立恢复快照，共 438 个文件。初次复制期间任务索引发生变化，冻结索引副本后复验全量 SHA-256。取回一个 57,275,516 字节的 FLAC，在 Mac 隔离目录验证 SHA-256 和格式。快照为 `/home/lyle/music-room-recovery/yuE2-before-release-2026-11-20/`。
- 有原件且任务状态为完成的 105 首全部归档到 106，校验无失败。4 个留有原音频的失败任务保持原状态，本机文件和 104 副本均保留。另有 1 条已彻底删除的历史记录，本机已无原件。
- 释放 79 个普通版本的本机原件，共 3,110,381,153 字节。26 个成品或灵感仍有本机原件。批量结束后冷启动恢复释放开关关闭。现网已释放样本通过签名 Range、服务端原音频 SHA-256 和 MP3 导出验收。
- 43 个旧构建二进制共 6,056,408,358 字节。完整压缩档从 106 受控目录可恢复，每个二进制曾按清单重新解包并校验。保留本机两个回退包，均通过签名检查、隔离冷启动和 HTTP 200。备份目录的录音、模型、回执和旧试验工作区保留。
- Mac 现网安装收据位于 `~/Applications/MusicRoom/installed-build.json`，独立包 SHA-256 为 `f454537756f9210dc203e4600f9c8100e9dda2574ee10ede917899993b690325`。存储、恢复与旧构建归档说明已同步到 104 运维文档。

[批量归档](../../test-results/minio-2026-11-20/archive-batch.log) · [独立恢复](../../test-results/minio-2026-11-20/backup-live.log) · [本机释放](../../test-results/minio-2026-11-20/release-backed-up.log) · [现网复验](../../test-results/minio-2026-11-20/verify-live-final.log) · [历史二进制](../../test-results/minio-2026-11-20/retired-builds-cleanup.log) · [回退冷启动](../../test-results/minio-2026-11-20/rollback-boot.log)
