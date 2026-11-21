# 2026-11-21 任务与资源页验证

「任务与资源」移除独立的「进行中与排队」区块，保留本机资源、原有历史列表和暂停／恢复后续任务。生成中与排队中的版本可在历史中筛选。本轮保留浏览器里的版本进度和后端队列接口，页面移除该区块的逐项取消入口。

## 执行结果

环境为 macOS arm64、Node v25.3.0，代码为 `b728c17` 加本轮工作区改动。浏览器使用测试替身或临时数据目录。

- 首次 Chrome 回归退出码 1。旧页面有「进行中与排队」标题，命中新加的移除断言。日志见 `test-results/task-list-removal/before.log`。
- 修复后 Chrome 专项通过 3 项，退出码 0。覆盖 52 项排队仍按每页 10 项展示、筛选、版本跳转期间连续播放、本机资源和暂停／恢复。日志见 `test-results/task-list-removal/focused-chrome.log`。
- WebKit 历史与布局专项通过 1 项，退出码 0。日志见 `test-results/task-list-removal/webkit.log`。
- `npm run verify:all` 退出码 0。构建通过，单元 122 项、服务 434 项、歌词 Python 12 项、实验规则 22 项、Chrome 工作台 80 项，乐谱、歌词、资源浏览器各 1 项均通过。日志见 `test-results/task-list-removal/verify-all.log`。

退役的逐项取消和队列进度界面用例随区块移除。版本进度仍由音乐与同步歌词浏览器用例覆盖，后台取消由服务及 HTTP／MCP 用例覆盖。

日常服务的监听进程保持原 PID。本轮只修改和验证工作区代码。
