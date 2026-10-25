# 2026-10-24 侧栏布局回归

## 改动范围

项目搜索框与新建项目的加号按钮合并为一行，移除重复的“项目”标题。桌面侧栏按剩余高度调整每页项目数量，最多 6 项；窗口缩放或展开资源详情时重新计算，小窗口通过分页访问完整项目列表。手机布局保留横向项目导航。

回归场景见 [UI-05](cases.md)。新建按钮保留原有名称与操作入口；真实模型验收脚本的 `data-action="new-project"` 定位仍然有效。

基线提交为 `b56fc33`，产品与测试修改未提交。环境为 macOS 27.0.1 / arm64、Node 25.3.0、Chrome 156.0.8078.47、Playwright WebKit 27.2；日期按 Asia/Shanghai。测试使用隔离目录、确定性音频驱动或接口替身，不代表真实模型推理或人工听评。未改动本轮开始前已有的启动器与本地服务文档工作。

## 首次失败与定位

1. 修改产品前增加小窗口回归，执行 `node --test --test-timeout=90000 scripts/verify-task-history-ui.test.mjs`：0 / 1，退出码 1。1280×720 下，项目列表的内容高度大于可见高度，10 秒内始终无法满足无内部滚动的断言。证据：`test-results/sidebar-2026-10-24/01-before.log`。
2. 实现后初步复验通过；补充长项目名称、19 项完整分页遍历、资源详情展开与深浅主题截图，复验 1 / 1，退出码 0。编辑中触发热更新的检查不作为最终验收；原日志保留在 `02-after.log`、`03-after.log`、`04-monitor-layout.log`。
3. 首轮 `npm run verify:all` 的 Chrome 兼容用例暴露已有时序问题：测试只等待对话框的 `open` 属性变为 false，立即断言焦点返回，早于浏览器排队发出的 `close` 事件。事件探针记录断言前焦点仍在正文输入框，随后 `close` 事件内正常返回创作按钮。测试改为等待“已关闭且焦点返回”这个可观察结果，保留原断言与超时；未增加重试，也未修改产品焦点逻辑。证据：`05-daily.log`、`05-first-chrome-failure.json`、`06-focus-probe.log`。

## 最终执行结果

本轮日常范围、WebKit 与实际 200% 缩放均完成验收。`npm run verify:all` 首次退出码为 1，停在上述焦点测试；修正等待条件后，单独复验该用例，再顺序执行尚未运行的乐谱、歌词和资源回归，不重复执行已通过且未改变的服务用例。不能将首次完整命令写成通过。

| 范围 / 命令 | 实际结果 | 本轮证据目录内的日志 |
| --- | --- | --- |
| `npm test` | 89 / 89，0 跳过，退出码 0；测试入口维护后再次通过 | `07-unit-final.log` |
| `npm run build` | TypeScript、原生辅助程序与 Vite 构建通过；退出码 0 | `05-daily.log` |
| `npm run test:service` | 343 / 343，0 跳过，退出码 0 | 同上 |
| `npm run test:lyrics-worker` | Python 12 / 12，退出码 0 | 同上 |
| `npm run test:experiments` | Python 14 / 14，Node 8 / 8，退出码 0 | 同上 |
| `npm run verify:studio`；修正后单独运行 `node --test --test-timeout=90000 scripts/verify-browser-compat.test.mjs` | 首轮 63 / 64，退出码 1；修正用例复验 1 / 1，退出码 0，0 跳过；包括侧栏新用例的其余 63 项沿用本轮结果 | `05-daily.log`、`08-compat-final.log` |
| `npm run verify:score` / `verify:lyrics` / `verify:resources` | 各 1 / 1，均退出码 0，0 跳过 | `09-score.log`、`10-lyrics.log`、`11-resources.log` |
| `npm run verify:webkit` | 8 / 8，退出码 0，0 跳过；已将项目侧栏回归接入该入口 | `12-webkit.log` |
| 隔离准备器执行 `npm run verify:system:zoom` | 退出码 0；真实浏览器缩放为 200%，DPR 2、视口 720×456、页面宽度 720；深浅主题的新建、创作、版本菜单、设置、回收站与下载通过 | `13-zoom.log`、`test-results/zoom-ui/verification.json` |

已查看 Chrome 与 WebKit 小窗口深浅主题截图，以及实际缩放的新建弹窗截图。侧栏项目区无内部纵向滚动；极低窗口下整条侧栏仍可滚动，以保留设置和资源详情的访问。

## 证据与清理

- 本轮日志：`test-results/sidebar-2026-10-24/`；产品与测试指纹：同目录 `source-sha256.txt`，构建指纹：`build-sha256.txt`。结束前重新核对全部源文件指纹一致，`git diff --check` 通过。
- 项目侧栏截图：`test-results/task-history/chrome/sidebar/` 与 `test-results/task-history/webkit/sidebar/`；1280×720、900×600，分别保留深浅主题。
- 实际缩放脚本：`scripts/verify-zoom-ui.mjs`；准备器位于本轮证据目录 `run-zoom.mjs`，只创建并清理自己的隔离工作区；结束后确认该目录已移除。
- 浏览器测试关闭自己的 Chrome / WebKit 会话和临时服务，不操作用户项目、浏览器、系统网络或辅助功能。
