# 海风留白 · v1

8 小节，96 BPM，4/4，20 秒，无人声。钢琴主旋律、钢琴和弦、贝斯与轻鼓。当前仅交付这段主题，扩写等试听反馈。

## 文件与使用

- `song.json`：导入 Music Room 的 music-room-score v1 乐谱。
- `compose.mjs`：完整独立作曲源码，只需 Node.js，无第三方依赖。执行 `node compose.mjs` 可原样重新生成本版本。
- `verify.mjs`：执行 `node --test verify.mjs` 检查速度、曲长、乐句留白、再现变化及音符边界。

在 Music Room 点击“导入 MIDI / JSON”并选择 `song.json`，使用本机音色试听、调整混音与导出 WAV。钢琴旋律应处于前景，伴奏与鼓保持轻；文件不包含页面混音设置。

## 乐句

第 1—2 小节 riff 是 **F♯4–A4–E5｜D5–A4–F♯4**。半拍休止后起句，向上张开，再落回，长音之间有呼吸。

第 3—4 小节回答是 **B4–D5–C♯5｜B4–A4–G4**，音区稍低，逐步下行。第 5—6 小节保留 riff 节奏，最高音升至 F♯5，形成一次小高潮；第 7—8 小节用 **D5–C♯5｜E5–D5** 收束，末音延长 2.75 拍，末尾留 0.75 拍音符空白，音色释放尾音可继续衰减。

和声：Dmaj9 → A(add9)/C♯ → Bm7 → Gmaj9 → Dmaj9/F♯ → Em7 → Asus4 / A(add9) → D6/9。贝斯提供方向，轻鼓用弱反拍、轻微后置军鼓和段尾减法建立律动。

## 版本身份

- `work.id`：`sea-breeze-f692a4e5`
- `work.title`：`海风留白`
- `revision.id`：`sea-breeze-v1-12c88a17`
- `revision.label`：`v1 · 八小节主题试写`
- `comparisonSections`：`{"theme":0}`，对应完整八小节。

后续同一作品保持 work 的 ID 和标题；复制到新版本目录，更新源码中 REVISION 的 ID 与名称，再生成文件。每个修订使用新的唯一 revision.id，保留旧文件。八小节主题的对比保留 `theme`、96 BPM 和相同小节数。

## 验证与试听边界

包内校验命令（从仓库根目录）：

```sh
node src/music/authoring/check.mjs compositions/sea-breeze/v1/song.json
node --test compositions/sea-breeze/v1/verify.mjs
```

**尚未实际试听。格式和结构检查通过不代表音乐已验收。** 试听请关注：前两小节是否好记、第 3—4 小节是否像自然回答、低音与轻鼓是否有松弛的推进感、最后的 D 长音是否收得舒服。反馈可直接标出小节号。
