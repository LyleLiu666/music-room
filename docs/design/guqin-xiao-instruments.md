# 古琴与箫音色接入（已搁置）

状态：已搁置，不实施。2026-11-24 由用户决定。本文保留搁置理由、重开条件和当时的调查结论。
适用范围：MIDI / JSON 乐谱路线，即浏览器试听引擎（`src/audio.ts`）与后台采样渲染器（`src/service/render/renderer.ts`）。YuE2 路线不受影响。
相关文档：[YuE2 本机生成](../yue2.md) · [外部创作与本机作品库](external-composition.md) · [独立创作包说明](../../src/music/authoring/README.md)。

## 1. 决定

- 暂不在 MIDI / JSON 路线接入古琴和箫。不改代码，不新增素材。
- 眼下要听《山居秋暝》，先用 YuE2 试，输入见第 3 节。
- 满足第 4 节的条件时重开。第 5 节的调查可以直接沿用。

## 2. 搁置理由

Music Room 现在的音色一部分是真实录音，一部分由代码合成：

| 音色 | 来源 | 现状 |
| --- | --- | --- |
| 钢琴 | Salamander Grand Piano（Yamaha C5 录音） | 17 个音高，单一力度层 |
| 弦乐、长笛 | VSCO 2 Community Edition | 小提琴合奏 4 个音高，长笛 6 个音高，均为持续音录音 |
| 电钢琴、拨弦、贝斯、鼓 | 项目代码合成 | 拨弦是物理建模，不是真实古筝采样 |

这条路走不通的原因，按影响大小排列：

1. **真实录音在这套引擎里也会显得生硬。** 力度只改变音量（`velocity ** 1.35`），没有轻弹与重弹的音色差别。采样之间的音高靠移调补齐。音与音之间没有连奏过渡。持续音不循环，长笛采样只有 5.5–7.6 秒，更长的音被静默截断。
2. **琴箫独奏正好暴露这些短板。** 古琴的滑音、句尾余音和箫的气息，是这类音乐里最容易听出真假的地方。织体稀疏，也没有别的声部可以遮挡。
3. **没有合格的素材。** 古琴找不到可随仓库分发的完整采样，只有约 1 秒的空弦片段和一段泛音乐句，余音、按音、泛音得部分或全部合成。箫有 CC0 的真实录音，但文件未能取得，音域和时长没有核对。详见 5.1。
4. **这条路线不能唱。** 乐谱格式不含人声，琴歌的人声仍然只能来自 YuE2。把 YuE2 的人声叠到采样伴奏上也不是简单的事：YuE2 的谱长与成品音频有偏差，[yue2.md](../yue2.md) 记录的 3 分钟纯音乐为谱 186.67 秒、音频 180.04 秒。
5. **改动面大，结果却无法事先保证。** 要像琴，至少得扩展乐谱格式（单音内的音高曲线）、同时改两套引擎、新建素材预处理流程、把音轨从 11 条加到 14 条，并补齐测试和文档。做完之后好不好听，仍然只能靠试听判断。
6. **以往的听评不支持这条路线。** 此前对单曲的反馈是，Agent 逐音编曲的整体听感不如音乐模型自主创作。乐器到位不改变这一点。

## 3. 现在的做法：用 YuE2

在创作空间里直接提交下面两组输入，各生成一版。它们是起点，听过再改。

试听时关注三件事：古琴和箫的音色像不像；能不能守住稀疏和留白；人声是否克制。

YuE2 是以流行歌曲为主的模型，无固定拍子的段落、琴箫的音色、不加鼓和贝斯这些要求，它未必照做。需要更细的控制时，可以由 Agent 写 ABC 乐谱交给 YuE2，做法见 [yue2.md](../yue2.md)；乐谱能约束音符和结构，不能保证音色和演奏方式。

**纯音乐（琴箫）**

风格：

```text
Instrumental traditional Chinese literati music, a slow duet of guqin (seven-string zither) and xiao (vertical bamboo flute), very sparse, free and unhurried, around 54 BPM. Low open guqin strings ring with long decay, bell-like guqin harmonics, sliding notes and slow finger vibrato. The xiao answers with long breathy phrases. Pentatonic, no chords, large silences between phrases. No drums, no bass, no piano, no synthesizer, no string section. Ends quietly on guqin harmonics. No vocals, no singing.
```

段落：

```text
[intro]
[verse]
[interlude]
[verse]
[outro]
```

**演唱（琴歌）**

风格：

```text
Ancient Chinese qin song, Mandarin, a calm mid-low male voice half chanting, half singing to himself, restrained, long held notes at the end of each line, no belting. Accompanied only by guqin, with a distant xiao between lines; a pipa enters briefly with a light pulse in the second verse. Very slow, about 56 BPM, sparse, pentatonic. No drums, no bass, no piano, no synth pads, no pop chord progression, no added chorus.
```

歌词：

```text
[Intro]

[Verse]
空山新雨后
天气晚来秋
明月松间照
清泉石上流

[Interlude]

[Verse]
竹喧归浣女
莲动下渔舟
随意春芳歇
王孙自可留

[Outro]
王孙自可留
```

## 4. 重开条件

满足任意一条即可重开：

1. 出现了 YuE2 加 Agent 写谱也满足不了的逐音控制需求。例如必须指定某个音用泛音、某处怎样滑音。
2. 手上已经有一套听着满意、许可允许随项目分发的琴箫音源。古琴至少要有散音、按音、泛音的单音，且余音完整；箫要有足够长的持续音；许可为 CC0 或 CC BY 一类。

重开时先做隔离的音色试听对照，不动产品代码。用户听过并接受之后，再进入正式接入。

## 5. 调查记录（未实施，重开时参考）

以下内容查于 2026-11-24，重开时需重新核对。

### 5.1 素材来源

| 乐器 | 来源 | 许可 | 内容 | 限制 |
| --- | --- | --- | --- | --- |
| 箫 | Musical Artifacts #4575「Beixiao (Raw ver.)」，pattingthestar 2023 年录制 | CC0 1.0 | 北箫真实录音的 SF2，5.47 MB，无循环点；站点记录的文件哈希为 `70dbf5a4…446efcfe` | **未核对**：站点下载有人机验证，未能取得文件。音域、采样数量、单音时长不明 |
| 箫 | Musical Artifacts #5070「Beixiao」 | CC0 1.0 | 同一批录音的带循环点版本 | 同上，未核对 |
| 古琴散音 | Freesound #176266「Guqin-open-strings.wav」，RafaelCaro | CC BY 4.0 | 七条空弦 C D F G A c d，44.1 kHz / 16 bit 立体声 WAV | 全长 7.1 秒，每个音约 1 秒后被下一个音打断；下载原始 WAV 需要登录 |
| 古琴泛音与空弦 | Wikimedia Commons，Charlie Huang 2006 年上传：`Fanyin.ogg`、`Zheng diao.ogg` 等 | 作者放弃全部权利（公有领域） | 12 秒泛音乐句；正调等 10 种调弦的空弦片段，各 10–14 秒 | Ogg Vorbis 约 80 kbps，有损；是乐句而非单音。只核对了 `Fanyin.ogg` 的许可页，其余文件使用前需逐个核对 |

查过但不能用的：

- 中国音乐学院 CTIS 数据库有古琴和箫，但许可为 CC BY-NC-ND 4.0，禁止演绎，不能切片后入库。
- VSCO 2 CE 与 VCSL（均 CC0）没有古琴和箫。VCSL 里最接近的是越南筝和竖笛。
- GitHub 上名为 xiao 的 CC0 采样（XSXB-Band-Samples）由竖笛加工而成，不是真箫。

### 5.2 代码接入点

| 位置 | 现状 |
| --- | --- |
| `src/music/score.ts` | `TrackId` 联合类型与 `TRACKS` 表，共 11 轨；`Note` 只有 `track / pitch / beat / duration / velocity` |
| `src/audio/voices.ts` | `SAMPLE_GROUPS` 定义采样音色的文件与根音；`synthesizeVoice` 生成合成音色 |
| `src/audio.ts` `Orchestra.note` | 每个音符一个固定 `playbackRate` 的音源；中途起播用 `elapsed * playbackRate` 计算采样偏移 |
| `src/service/render/renderer.ts` | 采样位置按 `pos = i * ratio` 计算；起音 / 释音常量与浏览器引擎各写一份 |
| `src/music/authoring/validate.mjs` | `TRACK_IDS` 列表；音符字段白名单，未知字段报错；`version` 只接受 1 |
| `src/music/import/midi.ts`、`src/midi.ts` | 明确的 GM 音色号映射，未知音色报错 |
| `src/service/service.ts:108` | 给 Agent 的轨道清单是手写字符串 |
| `src/workbench/score-editor.ts` | 音轨行与混音器由 `TRACKS` 生成 |
| `scripts/build/download-assets.mjs` | 任务清单写死，只做原样下载，每次运行用任务清单重写 `manifest.json` |
| `public/samples/` | 28 个文件，约 20 MB，随仓库提交，并由 `build-binary.mjs` 整目录内嵌 |
| 测试 | `tests/import.test.ts` 断言 `TRACK_IDS` 与 `TRACKS` 一致；`tests/midi.test.ts` 断言轨数与音色号；`src/service/render/renderer.test.ts` 用自相关验证音高 |

### 5.3 当时的设计要点

- **音轨。** `guqin`（实音）、`guqin-harmonic`（泛音）、`xiao`。MIDI 音色号拟用 GM 107、32、78，与现有映射不冲突。散音与按音不拆轨，差别由音区和时值体现。
- **音高曲线。** 音符加可选字段 `bend`，为若干 `[拍数偏移, 半音偏移]` 点，点之间按半音线性变化，用来表达绰、注、上、下、吟、猱。格式保持 `version: 1`，旧程序遇到该字段会拒绝，不会错误演奏。
- **两套引擎。** 浏览器在 `playbackRate` 上排程指数渐变；后台改为逐采样累加位置。音符从中途起播时，采样偏移必须按曲线积分计算，这是最容易出错的地方。
- **古琴声音。** 两个候选：纯合成；或真实空弦起音加合成余音。泛音用合成。由试听对照决定。
- **箫。** 用 CC0 采样，离线续接到每个单音不短于 8 秒，运行时不做循环。
- **素材清单。** `manifest.json` 需要能记录派生素材的原始来源、原始哈希和所做改动；`download-assets.mjs` 不能在重跑时抹掉新条目。
- **测试。** 先对现有示例的后台渲染结果记录哈希，保证旧乐谱不变；再为曲线校验、曲线积分、新音色的音高与余音、MIDI 往返、14 条音轨的界面补用例；听感单独做人工听评。

## 6. 调查中发现的现有问题

这三项与是否接入琴箫无关，现在就存在。是否处理另行决定，本文不安排。

1. `synthesizeVoice` 对不认识的音色名会落入踩镲 / 镲片的噪声分支。以后新增音轨时若漏配采样或合成分支，会静默发出噪声，而不是报错。
2. 起音 / 释音常量在两个引擎各写一份，文件扩展名规则 `kind === 'piano' ? 'mp3' : 'wav'` 也各写一份，改一处容易漏另一处。
3. 持续音采样不循环，音符长于采样时被静默截断，不提示。长笛采样为 5.5–7.6 秒，弦乐约 12 秒；向上移调时可用时长更短。
