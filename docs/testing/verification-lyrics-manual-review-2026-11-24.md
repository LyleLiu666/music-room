# 2026-11-24 同步歌词人工校对

已生成的同步歌词支持校对文字、起止时间和待定位句。播放器可试听原识别范围，取当前播放位置作为时间。早期草稿没有试听范围时可在播放器自行定位。被保留的待定位句继续显示，排除误识别文本后从当前歌词及 LRC 移除。

## 回归记录

- 旧版读取已保存的歌词草稿时未返回待定位句和时间上限。修复后覆盖逐字保存、时间越界、并行修改冲突、旧草稿缺少试听范围及 LRC 时间戳。原始创作歌词和音频文件保持原值。[首次复现](../../test-results/lyrics-manual-review-2026-11-24/read-save-red.log) [旧草稿复现](../../test-results/lyrics-manual-review-2026-11-24/legacy-unlocated-red.log) [专项复验](../../test-results/lyrics-manual-review-2026-11-24/legacy-unlocated-green.log)
- Chrome 首次检查发现同步句的序号把待定位句也算在内，修改第 3 句时选中了第一条同步句。按不同序列编号后，Chrome 和 WebKit 覆盖试听、拒绝相等起止点、排除误识别、保存、刷新、窄屏及 LRC 导出。[首次 Chrome 日志](../../test-results/lyrics-manual-review-2026-11-24/chrome-numbering-failure.log) [Chrome 专项](../../test-results/lyrics-manual-review-2026-11-24/chrome-focused.log) [WebKit 专项](../../test-results/lyrics-manual-review-2026-11-24/webkit-focused.log)

浏览器回归使用隔离音频和已有的歌词生成替身。未重新识别正式歌曲，也未更改正式工作区中的歌词内容。

合并版本通过日常回归，包括单元 122 项、服务 436 项、Chrome 工作台 80 项、Chrome 歌词 1 项。WebKit 歌词专项 1 项和独立包 23 项检查通过。已更新本机 57923 服务，正式草稿通过只读检查显示两句待定位，歌词文件哈希一致。[日常回归](../../test-results/lyrics-manual-review-2026-11-24/verify-all.log) [WebKit 复验](../../test-results/lyrics-manual-review-2026-11-24/webkit-final.log) [本机安装](../../test-results/vocal-abc-omission-2026-11-24/deployment.json)
