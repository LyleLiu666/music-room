# Mac 原生调速试听试验

独立试验，不修改正式服务、音色库或版本记录。用 AVAudioUnitTimePitch 保持音调并离线调速，再通过同一份 WAV 试听和下载，保存时不重新处理。

用户已试听实际人声的 0.85 倍结果并接受。正式页面尚未接入；此提交保留可复现实验和验证，不宣称浏览器原生调速与 Apple 离线算法完全相同。

## 使用

需要 macOS 和 Xcode Command Line Tools。原始文件应为 WAV。临时二进制和音频放在忽略目录，音频不提交。

```bash
xcrun swiftc -O scripts/speed-preview-trial/render.swift -o /tmp/music-room-speed-render
mkdir -p test-results/speed-native-trial
cp /你的原音.wav test-results/speed-native-trial/original-v16.wav
cp /你的旧调速版.wav test-results/speed-native-trial/old-saved-v17.wav
/tmp/music-room-speed-render test-results/speed-native-trial/original-v16.wav test-results/speed-native-trial/voice-085-apple.wav 0.85
node scripts/speed-preview-trial/serve.mjs test-results/speed-native-trial
```

打开服务器打印的地址，对照试听并点击“保存这份试听音频”。下载使用播放器的同一个文件地址，不重新生成。网页固定展示 0.85 倍实验；命令行渲染器支持 0.5–2.0 倍。

## 验证

```bash
node scripts/speed-preview-trial/verify.mjs /tmp/music-room-speed-render
```

自动创建临时音频，检查时长、音高、声道、有效采样、首尾声音，以及播放器与下载文件的逐字节一致性。验证结束关闭浏览器和临时服务器并清理文件；听感仍需要实际人声试听。
