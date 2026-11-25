# 2026-11-22 演唱 ABC 入队检查

演唱模式填写歌词并指定 YuE2 ABC 时，复用谱面解析器统计人声轨音符。只有休止符的谱在入队前提示补写人声旋律，或清空 ABC 切换为自由规划。网页使用原有的输入检查显示提示并保留草稿。服务在创建生成队列任务前使用同一检查。

## 验证

- 基于 `29f73c2` 及本轮工作区改动，使用 macOS arm64 和 Node v25.3.0。首次专项在旧代码上退出码 1，检查结果缺少提示。修复后专项 1 项通过，确认自动和指定时长均可拦截，且没有新队列项或模型启动。日志为 `test-results/vocal-abc-preflight/before.log` 和 `after.log`。
- 首次日常入口在构建时发现测试直接读取了可能为空的结果，TypeScript 检查失败。测试改用同一个有明确返回值的检查函数后重新运行，首次日志保存在 `test-results/vocal-abc-preflight/build-typecheck.log`。
- 只读核对《11 放克街区 · 演唱 · ABC 谱》V1。实际乐谱和歌词使用本机分词器检查，自动、240 秒均被拦截，清空 ABC 后原歌词通过。此项只运行谱面检查和分词。
- Chrome 创作表单专项 1 项通过，退出码 0。休止谱的提示可见，生成按钮未提交请求，清空 ABC 后恢复有效状态，原歌词仍在。日志为 `test-results/vocal-abc-preflight/chrome-focused.log`。
- 日常回归 `npm run verify:all` 退出码 0。构建通过，单元 122 项、服务 435 项、歌词 Python 12 项、实验规则 22 项、Chrome 工作台 80 项，乐谱、歌词、资源浏览器各 1 项均通过。日志为 `test-results/vocal-abc-preflight/verify-all.log`。

本轮验证使用测试替身或现成输入，只检查提交行为。日常服务和现有任务保持运行。
