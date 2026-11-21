# 新版本草稿来源修复

「再创作一版」打开草稿和提交时校验来源版本。来源已删除、已不可读或属于其他声音时，移除来源引用并保存草稿。仍有效的来源随新版本提交。

## 验证

| 范围 | 结果 | 记录 |
| --- | --- | --- |
| 修复前 | 两个浏览器用例均复现，提交带有已彻底删除的版本 ID | [失败日志](../../test-results/draft-source/red.log) |
| 定向回归 | Chrome 20 项、WebKit 8 项通过，覆盖删除后重新打开与表单仍打开两种情况 | [Chrome](../../test-results/draft-source/chrome.log) · [WebKit](../../test-results/draft-source/webkit.log) |
| 全量日常 | `npm run verify:all` 通过，含 126 项单元、434 项服务、84 项 Chrome 验收、34 项歌词与实验测试 | [全量日志](../../test-results/draft-source/verify-all.log) |
| 独立包专项 | Chrome 从内嵌网页提交新版本，刷新后仍保留已修正的草稿 | [独立包专项](../../test-results/draft-source/binary-draft.log) |
| 本机安装 | 服务在原端口 57923 重启，核对网页脚本指纹、8 个项目 ID 和 MinIO 播放地址配置 | [安装记录](../../test-results/draft-source/install.log) |

回归在隔离工作区通过实际服务彻底删除来源。测试检查提交请求和刷新后的草稿，生成结果使用测试替身。系统和源码指纹见[环境记录](../../test-results/draft-source/environment.json)。

独立包全量验收首轮因系统内存压力过高，离线 WAV 渲染未取得资源，保留[首轮日志](../../test-results/draft-source/binary.log)。安装检查先定位到错误的脚本链接，随后一次重启校验遇到旧 HTTP 连接复用并回退原程序。改用新连接后重启校验通过。[安装预检](../../test-results/draft-source/install-preflight.log) · [首次重启](../../test-results/draft-source/install-first-restart.log)
