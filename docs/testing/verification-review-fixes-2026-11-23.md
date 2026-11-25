# 2026-11-23 乐谱试听与演唱 ABC 回归

基线为 `635cea6`，在 macOS arm64、Apple M4、Node v25.3.0、Chrome 157 和 Playwright 1.64.0 上执行。独立包使用 Bun 1.4.2。

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 乐谱试听 | 排队中的试听在任务历史显示「已完成」，用例退出码 1。[首次日志](../../test-results/review-fixes-2026-11-23/score-red.log) | Chrome 通过 2 项。覆盖在历史中取消排队任务、在版本页取消运行中的任务、再次生成并读取音频。[复验日志](../../test-results/review-fixes-2026-11-23/score-green.log) |
| 演唱 ABC | 给全休止人声谱填写标题后，解析失败仍可入队，用例退出码 1。[首次日志](../../test-results/review-fixes-2026-11-23/abc-red.log) | YuE2 管理测试通过 15 项。自动和指定时长均拒绝无法解析的演唱 ABC，队列保持为空。测试使用真实谱面解析器和固定分词结果。[复验日志](../../test-results/review-fixes-2026-11-23/abc-green.log) |

`npm run verify:all` 退出码 0。构建通过，单元测试 122 项、服务测试 435 项、歌词 Python 12 项、实验规则 22 项、Chrome 工作台 80 项、乐谱 2 项、歌词和资源浏览器各 1 项通过。[全量日志](../../test-results/review-fixes-2026-11-23/verify-all.log)

`npm run verify:webkit` 通过 19 项。独立包验收通过 23 项，包含实际乐谱渲染、音频播放、MCP 和重启恢复。包的 SHA-256 为 `611765c30274f8a185a7c4e5d4e783ed3662f943df1077fc1260a717f1345253`。本轮演唱 ABC 验证止于谱面检查与入队行为，未运行音乐推理和人工听评。[WebKit 日志](../../test-results/review-fixes-2026-11-23/webkit.log) · [独立包日志](../../test-results/review-fixes-2026-11-23/binary.log)
