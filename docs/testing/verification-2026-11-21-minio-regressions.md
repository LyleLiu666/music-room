# 2026-11-21 YuE2 恢复和试听回归

- 恢复副本彻底删除歌曲后，副本无法试听。原工作区仍可读取相同的 FLAC、ABC 乐谱和 MinIO 分段音频。原工作区仍可彻底删除自己的原件。
- 隔离 MinIO 服务暂停期间，Chrome 的项目播放器和声音库队列都通过本机服务播放了原件。恢复 MinIO 后，已释放本机原件的歌曲仍能使用远端分段播放和 MP3 导出。

| 验证 | 结果 | 记录 |
| --- | --- | --- |
| 修复前 | 项目播放器和声音库队列均无法回退，副本删歌后原工作区音频返回 HTTP 503 | [失败复现](../../test-results/minio-regressions-2026-11-21/red.log) |
| 源码专项 | 隔离 MinIO、Chrome、实际暂停存储服务和恢复副本删除通过 | [源码验收](../../test-results/minio-regressions-2026-11-21/green-outage-source-final.log) |
| 日常回归 | 两项 MinIO 修复完成后，`npm run verify:all` 通过，含 126 项单元测试、434 项服务测试、84 项 Chrome 验收及 34 项歌词与实验测试。WebKit 另通过 19 项 | [日常回归](../../test-results/minio-regressions-2026-11-21/verify-all.log) · [WebKit](../../test-results/minio-regressions-2026-11-21/webkit.log) |
| 乐谱播放复验 | 独立包首轮出现 WAV 加载超时。延迟 WAV 响应复现后完成修复。最终复跑乐谱回归 1 项、播放器回归 16 项及单元测试 126 项，均通过 | [独立包首轮](../../test-results/minio-regressions-2026-11-21/binary-full.log) · [失败复现](../../test-results/minio-regressions-2026-11-21/score-red.log) · [乐谱复验](../../test-results/minio-regressions-2026-11-21/score-final.log) · [播放复验](../../test-results/minio-regressions-2026-11-21/playback-recheck.log) |
| 最终独立包 | 编译后的备份、恢复、跨工作区删除隔离、MinIO 中断回退均通过。完整独立包验收通过 23 项 | [独立包专项](../../test-results/minio-regressions-2026-11-21/green-outage-binary-final.log) · [完整独立包](../../test-results/minio-regressions-2026-11-21/binary-full-final.log) |

播放器定向复验首轮在编辑源码时触发 Vite 页面重载，清空了浏览器测试状态。重新构建后同组用例全部通过。[定向复验首轮](../../test-results/minio-regressions-2026-11-21/playback-final.log)

最终独立包使用 Bun 1.4.2 构建，SHA-256 为 `817be341e52cf4ac6f3403310d95edaf460a103769399530586ecebfce264afe`。
