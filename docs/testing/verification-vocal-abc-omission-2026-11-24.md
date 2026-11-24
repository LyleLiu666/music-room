# 2026-11-24 全休止人声轨生成

演唱有歌词、人声轨全休止且伴奏轨有音符时，生成使用伴奏轨和原歌词。模型输入略过人声轨及轨内和弦标记。原双轨谱继续用于时长检查和版本编辑。

## 试验样本

《11 放克街区 · 演唱 · ABC 谱》V1。快速档实跑保留伴奏轨的 561 个音符和原歌词，移除人声轨及其中的 104 个和弦标记。成品 151.4 秒。未给参考词的本机语音识别匹配到两句完整歌词及其他片段，音高与时序对照匹配到前奏和多段伴奏旋律。人工试听待确认。原 V1 使用质量档，两版的差异包含档位变化。试验报告、两版试听和原始识别输出见[试验目录](../../test-results/abc-vocal-removal-2026-11-24-fast/)。

正式调用链使用本机固定版 YuE2 的提交参数校验、分词器及乐谱规划接口复验。约四分钟档下，解析所得模型乐谱和分词前缀与实跑试验逐项相同，原歌词和原双轨谱保存在检查点，重新加载得到一致结果。自动和约四分钟的输入通过检查，约一分钟因原谱长 235.5 秒被拒绝。正式流程的最终音频时长门槛照常执行。[原生协议日志](../../test-results/vocal-abc-omission-2026-11-24/native-protocol.log)

## 回归记录

- 在旧实现上，服务专项因全休止演唱谱被拦截而失败，Python 专项因模型输入缺少删轨处理而失败。正式实现后覆盖了模型输入、原歌词、双轨谱重新读取、检查点重新加载和目标时长。[服务首次日志](../../test-results/vocal-abc-omission-2026-11-24/managed-red.log) [运行时首次日志](../../test-results/vocal-abc-omission-2026-11-24/runtime-red.log)
- 日常回归前两次出现 macOS 资源采样子进程三秒超时。单独复测五项通过。随后在独立临时目录重跑，435 项服务测试全部通过，保留原采样逻辑和阈值。[首次日志](../../test-results/vocal-abc-omission-2026-11-24/verify-all.log) [第二次日志](../../test-results/vocal-abc-omission-2026-11-24/verify-all-recheck.log) [独立目录日志](../../test-results/vocal-abc-omission-2026-11-24/verify-all-isolated.log)
- 删轨版本的日常回归与独立试验台通过。和歌词校对合并后，完整日常回归、WebKit 歌词校对专项及独立包 23 项检查通过。[合并回归](../../test-results/lyrics-manual-review-2026-11-24/verify-all.log) [独立包](../../test-results/lyrics-manual-review-2026-11-24/verify-binary.log)
- 本机更新前确认任务队列为空。首次切换的检查连接在重启时重置，已回滚。使用新连接复验后安装成功，仍使用 57923。九个项目、266 个版本的标识逐一一致。同一首歌在正式服务上通过自动和约四分钟输入检查，约一分钟仍被拦截。 [首次切换记录](../../test-results/vocal-abc-omission-2026-11-24/deployment-before-connection-fix.json) [安装复验](../../test-results/vocal-abc-omission-2026-11-24/deployment.json)
