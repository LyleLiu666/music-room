# 原生 TTS 收尾修复

当前程序基于 audio.cpp v0.9.1，版本 `0.9.1-music-room-tail1`。仅修改 IndexTTS 2.0 的声学收尾边界；模型仍为 F16。补丁不含诊断数据采集或调试接口。

## 构建

在 macOS arm64、已安装 CMake 和 Apple 编译工具的环境运行：

```sh
node scripts/build-native-tts.mjs
npm run build:binary
npm run verify:binary
```

构建脚本按固定 SHA-256 校验上游源码，应用本目录补丁，再编译 Metal 原生服务。产物为 `public/tts-native/audio-cpp-v0.9.1-tail1-macos-arm64.tar.gz` 与 `src/service/tts/native-program-manifest.ts`，两者一起提交。独立应用打包该程序，模型权重另行缓存，升级复用原权重。

## 变更边界

`index_tts2.tail_context_frames` 默认 0，Music Room 显式启用 32；只允许 IndexTTS 2.0，范围 0–64。原生会话校验与 CLI 参数表都登记此选项。声学条件扩展、噪声前缀保持、波形还原保护与最终输出保留长度在补丁中；上游其他模型不采用该处理。

程序包包含上游许可证、第三方许可证、修改补丁与来源哈希。更新补丁后必须重新构建程序及应用、执行真实队列回归，再切换服务；不能只修改 TypeScript 配置而沿用旧原生程序。

[效果与诊断](../../docs/tts-prosody-test-2026-10-09.md) · [生命周期与回退](../../docs/tts-native-engine.md)
