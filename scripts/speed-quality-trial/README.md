# 0.5 倍人声听感对照

用户反馈原生调速在 0.5 倍有重复、颤动和机器人感，随后对照试听选择 B（Rubber Band R3）更自然。正式 macOS 保存流程已接入 R3，见 `native/speed/render.cpp`。本目录保留可复现实验；运行实验本身不修改正式算法或版本库。

- A：Apple 原生算法，平滑参数从 8 提高到 32。
- B：Rubber Band 4.0.0，R3 引擎，两遍离线处理，默认窗口，保持音高。

两份均从同一原音直接生成，保持采样率、声道及精确两倍时长；编码前匹配平均电平并预留峰值余量。自动检查包括音高、声道分离、首尾保留、短音不重复或丢失、时间位置、有限采样和不削波。机器人感最终必须通过真实人声试听判断。

## 复现（macOS）

需要 Xcode Command Line Tools、Node 及本项目依赖。实验第三方源代码与构建产物放在忽略目录。正式应用通过独立子进程调用 R3 辅助程序，辅助程序及所链接的 Rubber Band 按 GPL-2.0-or-later 提供，完整对应源代码、许可和构建脚本随应用内嵌于 `speed-native/source.zip`。

```sh
mkdir -p test-results/speed-quality
git clone --depth 1 --branch v4.0.0 https://github.com/breakfastquay/rubberband.git test-results/speed-quality/rubberband
node scripts/speed-quality-trial/run.mjs /绝对路径/原音.wav test-results/speed-quality test-results/speed-quality/rubberband
```

脚本校验源码固定为 `1d95888bec3ae0a17c0c4af791810d5a63f6bc35` 且未修改，编译两种处理程序、先验证测试信号，再生成 A/B WAV 与 `quality-report.json`。每次新生成的报告仍标记 `listeningVerdict: pending`；已选择 B 的反馈不能自动当成所有新素材的听感结论。

参数依据：[Apple overlap](https://developer.apple.com/documentation/avfaudio/avaudiounittimepitch/overlap)、[Rubber Band 集成说明](https://www.breakfastquay.com/rubberband/integration.html)。
