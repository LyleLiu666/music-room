# 翻唱这段与玩一段交付验收（2026-11-24 至 25）

在 Apple M4、32 GiB 统一内存的隔离工作区验收。复用固定模型文件时重新检查 SHA-256。浏览器替身测试和真实推理分别执行。使用日常工作区的任务验证跨工作区资源保护，日常服务继续运行。

## 审查与修正

- 手机声音库新增入口后，390 px 宽时工具和页头由 193 px 增至 230 px，超过既有 220 px 上限。收紧按钮和列距后，Chrome 和 WebKit 均复验为 193 px，首屏显示 10 条完整声音。首次全量 Chrome 81 项通过、1 项失败，保留 `all.log` 和 `library-layout-first.json`。
- 宽屏开启「玩一段」时，入口与声音库标题同排，页签在下一行，来源单独成列。新增浏览器布局断言，首次失败与复验见 `live-layout-first.log`、`live-layout-second.log`。
- 原歌词无时间标记时，选段按全曲时长与歌词顺序估算，并保留段落标签。界面提示试听校对。保留新增断言的首次失败 `plain-lyrics-first.log`、包含该失败的 `all-second.log` 及专项复验 `plain-lyrics-second.log`。
- 独立包内嵌固定源代码构建的 ACE-Step 程序及 MIT 许可，准备时校验程序和模型哈希。关闭构建机专属 CPU 指令探测，缓存将构建选项纳入校验。源码开发入口仍可本地构建。

日志位于 `test-results/cover-live-final-2026-11-24/`。浏览器截图位于 `test-results/ace-cover-ui/` 和 `test-results/magenta-live-ui/`。

## 真实模型

| 场景 | 结果 | 音频及报告目录 |
| --- | --- | --- |
| ACE-Step 1.5 翻唱 | 摇滚女声配置，15.00 秒，23.62 秒完成，任务内存采样峰值 1.70 GB。原曲哈希和成品标记未变。首次输出 15.04 秒，按所选尾点裁剪多余采样后复验。 | `test-results/ace-cover-2026-11-24/real-second/` |
| Magenta RealTime 2 Small | 冷启动到首块 32.54 秒。余下 16 块每秒音频用时 0.473–0.522 秒。采样峰值 1.36 GB。生成 17 块并从播放位置回留精确 15 秒，48 kHz、双声道。验证声音库来源、加入项目后的音频和灵感标记、停止后的资源释放。 | `test-results/magenta-live-2026-11-24/real-second/` |

Magenta 首次准备被日常工作区 YuE2 的真实租约挡住。保留 `test-results/magenta-live-2026-11-24/real-first.log`。正向复验在资源释放后完成。内存是任务进程采样值。当前只记录音频与技术检查，其他唱法预设和风格组合仍需各自听评。

## 全量回归

- `npm run verify:all` 通过。122 项单元、445 项服务、12 项歌词 Worker、14 项歌词实验 Python、8 项歌词实验 Node、82 项 Chrome 工作台、2 项乐谱、1 项歌词界面和 1 项资源界面测试通过。日志 `all-final.log`。
- `npm run verify:webkit` 通过。21 项，包括两项新功能的日夜主题、小窗口及听播交互。日志 `webkit.log`。

## 独立包与真实互斥

- Bun 1.4.2 构建 macOS arm64 独立包，大小 144,175,986 字节，嵌入 84 项资源。SHA-256 为 `ea93bc7e01791bbc954092dd8d53d65f36c4a7533bf60722a7d093c11b0514a4`。签名验证通过。日志 `package-final.log`。
- `npm run verify:binary` 通过 24 项检查。移开开发构建目录，用独立包启动、核对 ACE 及音频资源哈希、浏览、渲染和恢复。独立包声音库专项另 1 项通过。日志 `binary-final.log`、`library-binary-final.log`。
- `npm run verify:cover-live:binary:real` 通过。Chrome 从独立包打开 Magenta，切换到迪斯科并回留 15 秒。ACE 在演奏中保持排队。按下停止后约 0.26 秒面板收起且 Magenta 已结束，ACE 随后完成 15.00 秒翻唱，任务采样峰值 1.65 GB。原曲哈希与提交前一致。核对本机实际运行的 ACE 程序与包内 SHA-256 一致。关闭隔离服务后确认租约释放。日志 `mixed-real-final.log`，截图、翻唱 WAV 和报告位于 `test-results/magenta-live-2026-11-24/real-second/`。
- 日常服务继续由原进程提供，仍使用 `127.0.0.1:57923`。
