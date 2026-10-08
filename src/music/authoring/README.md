# Music Room 独立创作包

外部 agent 只需要此包，无需工作台项目源码。可以用 JavaScript、Python 或其他语言作曲，输出 JSON 或 MIDI；用户把文件导入 Music Room，使用工作台音色试听、混音并导出 WAV。页面不运行上传的作曲脚本，不需要后台或付费服务。

## 使用顺序

1. 用户先选择 4/8 小节的短乐句，或对满意的版本选择扩写；把本包和页面生成的提示词（也可参考 `prompt.txt`）交给 agent。扩写时一并附上当前版本 JSON。
2. Agent 参考 `example.json` 写独立作曲代码，交付 `song.json` 和源码。完整示例有八小节，不是三分钟作品模板。
3. 使用 Node.js 22.18+ 执行 `node check.mjs song.json`。校验器无第三方依赖；仅检查格式与播放器边界，不评价好不好听。
4. 用户在 Music Room 点击“导入 MIDI / JSON”或把单个文件拖入导入区域，选择文件；试听、修改混音、导出 WAV 或 MIDI。
5. 将试听反馈交给 agent，交付新版本，再导入比较。源文件、MIDI、JSON 和音频均由用户保存在自己电脑；浏览器副本只方便下次打开。

## JSON 契约：music-room-score，版本 1

`example.json` 是可直接导入的完整文件。顶层字段：

| 字段 | 含义 |
| --- | --- |
| `format` | 固定 `music-room-score` |
| `version` | 固定数字 `1`，指格式版本 |
| `work` | `{id, title}`；同一首歌所有版本保持一致 |
| `revision` | `{id, label}` 必填；可选 `summary`、`description`、`key`、`englishTitle` |
| `comparisonSections` | 可选，例如 `{"theme":0,"chorus":1}`；共同段落 ID 对应从 0 开始的段落索引 |
| `score` | `{title, bpm, duration, sections, bars, notes}` |

歌曲 ID 和版本 ID 使用小写字母开头的字母、数字、短横线，最多 64 字符。版本 ID 必须在用户作品库里唯一，不能覆盖已有版本。同名歌曲用不同 `work.id` 分组；与内置歌曲同 ID 的新增版本必须保持标题一致。下载内置曲目 JSON 后，修改 `revision.id` 再导入可成为该歌曲新版本。普通 MIDI 不包含这些版本信息，导入时自动创建独立歌曲；需版本分组时下载其 JSON，后续沿用 work.id、改变 revision.id。

`score.title` 与 `work.title` 相同。`bpm` 固定且范围 40—240；当前不支持变拍和曲内变速。`duration` 是秒，必须等于 `bars.length * 4 * 60 / bpm`，总长最多 600 秒。小节数量 1—512；建议以明确结构创作，三分钟、96 BPM 对应 72 小节。

`sections` 每项 `{name, subtitle, startBar, bars, color}`，可选 MIDI 标记 `midiName`。`startBar` 从 0 开始；段落依次连续、覆盖全部小节；`bars` 是该段落小节数。`color` 使用 `#RRGGBB`。`bars` 每项 `{chord, section}`，`chord` 是用于显示的文本或空字符串；`section` 是从 0 开始的段落索引，必须和段落边界一致。

`notes` 每项如下，不需要按拍排序，导入会排序：

```json
{"track":"melody","pitch":69,"beat":0,"duration":1,"velocity":0.8}
```

它在全曲第 0 拍开始，以 0.8 力度演奏一个持续 1 拍的 A4。`pitch` 是整数 MIDI 音高 0—127；中央 C 是 60。`beat` 和音符 `duration` 单位均为四分音符拍，允许小数；音符力度 `velocity` 范围 0.001—1，时值最小 0.001 拍。休止以没有音符表达；和弦用相同 beat 的多个音符表达。音符必须在全曲内结束。

单文件最多 4 MiB、20,000 个音符，同时持续最多 256 个音符。文本和字段长度按 `validate.mjs` 检查；未知字段报错，避免拼错字段后静默丢失信息。人声、歌词、外部音源和效果器配置不属于此格式。

## 可用音色与 MIDI 对应

JSON 轨道和 MIDI 的标准音色如下。表中 GM 编号从 1 开始；代码设置 instrument.number 时减 1。MIDI 只映射这些音色，其他音色报错，不自动猜测。

| JSON 轨道 | 工作台声音 | MIDI |
| --- | --- | --- |
| melody | 主旋律，默认钢琴，可在混音器切为电钢琴/长笛 | 第一个非空 GM 1 钢琴轨 |
| piano | 钢琴伴奏 | 后续非空 GM 1 钢琴轨 |
| rhodes | 合成电钢琴 | GM 5 |
| pluck | 合成拨弦，非真实古筝 | GM 108 |
| flute | 长笛采样 | GM 74 |
| strings | 弦乐采样 | GM 49—52 |
| bass | 合成贝斯 | GM 33—40 |
| kick | 合成底鼓 | MIDI 通道 10，音高 35、36 |
| snare | 合成军鼓/拍手 | 通道 10，37、38、39、40 |
| hat | 合成踩镲 | 通道 10，42、44、46 |
| cymbal | 合成镲片 | 通道 10，49、51、52、55、57、59 |

鼓轨 JSON 建议使用底鼓 36、军鼓 38、踩镲 42、镲片 49，便于导出的 MIDI 与其他软件交换。MIDI 不携带采样、混响或混音，本页面按上表重新演奏。原文件里的弯音、踏板、表情等 MIDI 控制暂不还原，页面会说明；创作优先用音高、时值与力度表达。MIDI 段落/和弦信息不导入；全曲以一个段落显示。导出 MIDI 的末端空白小节没有声音事件，重新导入按最后音符结束位置取整到小节；需要保留准确段落与时长请同时保存 JSON。

## 如何迭代

给 agent 的反馈应该落到可听的段落，例如“主题第 5—8 小节回答句太密，减少音符，末音延长；副歌保留 riff 节奏，把旋律抬高，最后两小节收束”。每次交付新版本，不覆盖旧版。A/B 只对同一作品、同速度、明确对应且等长的段落开放。

页面的 WAV 使用点击导出时的混音；JSON 保存作曲数据，MIDI 保存演奏事件，两者不保存临时混音。浏览器存储绑定当前地址和浏览器，清除站点数据会删除副本，请下载备份；没有上传云端或跨设备同步。重新导入下载的备份即可恢复。

项目代码与本包为 MIT；钢琴采样须保留 Alexander Holm / Salamander Grand Piano 的 CC BY 3.0 署名，长笛和弦乐为 VSCO 2 CE（CC0）。页面“音色来源与开源许可”提供完整署名。
