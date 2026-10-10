# Music Room · 声音创作空间

按「项目 → 声音 → 版本」组织音乐和语音。一个项目可以包含 riff、完整作品和旁白；所有结果统一试听、保留灵感、选择成品或删除恢复。创作表单按需打开，MIDI 与音轨编辑从版本菜单进入。

已完成的音频可在播放器下方调整速度（0.5–2.0 倍，支持 0.8 倍快捷选择和 0.01 倍细调），试听后点击「保存调速版」。系统保持音调，将结果保存为独立的 WAV 新版本，保留原版；新版本以 1.0 倍播放，下载时也包含调整后的速度。再次调整是相对于当前版本的音频。

项目中的「新声音 → 音色转换」支持提取人声、零样本换声和混回原背景音，保留完整歌曲时间线；每次转换保存为片段的新版本。当前已验证 Apple Silicon + Seed-VC F16 + Metal 离线处理，见[使用说明与验收范围](docs/voice-conversion.md)。歌曲提取参考仅用于音色转换；TTS 使用独立的自然说话参考。

服务使用本机项目目录保存版本和产物，不依赖浏览器保持打开。无需 Electron / `.app`、在线模型或付费 API；乐谱工具也在同一创作空间中按需打开。服务运行说明见 [本地服务](docs/local-service.md)，正式页面交互规则见 [声音创作空间](docs/design/studio.md)。

## 新 UX 提案

[本机模型与资源](docs/model-resources.md)说明已实现的统一队列、动态内存预算、所属进程释放和当前支持范围。三个引擎与辅助处理按实际硬件准入；不假设每台电脑都有 32 GiB。架构见[设计](docs/design/model-resource-management.md)，实施和验收见[开发计划](docs/design/model-resource-management-plan.md)及[逐轮记录](docs/design/model-resource-development.md)。

正式首页已采用统一创作空间，启动本地服务即可使用。`/speech.html` 为兼容入口；`/score.html#版本ID` 仅保留为旧链接兼容入口，自动定位回对应声音版本。MIDI 与音轨从版本菜单在当前空间打开。早期 [UX 提案](docs/design/sound-first-ux.md)及 `public/prototypes/sound-first/` 仅保留为设计历史，不是正式入口。

## 本地服务与单二进制

从源码构建一次：

```sh
npm ci
npm run build:binary
./release/start.sh --workspace "$HOME/Music/MusicRoom"
```

按终端 URL 在已有浏览器听评。构建产物是 `release/music-room` 和启动脚本 `release/start.sh`，运行它们无需安装 Node/Python；构建工具仅用于开发。Agent 通过 stdio / HTTP MCP 调用相同的项目、版本、后台渲染和反馈能力。二进制对应构建机器的操作系统与架构。

[启动、MCP 连接与构建说明](docs/local-service.md) · [YuE2 自动安装与生成](docs/yue2.md) · [IndexTTS 2.0 语音创作](docs/tts.md) · [技术设计与四轮边界](docs/design/local-service.md)。MIDI/JSON 创作闭环已经实现；YuE2 通过网页或内置 MCP 生成音乐。统一页面通过 IndexTTS 2.0 生成真实语音，支持参考声音复用、情绪描述、多版本试听、成品选择、删除恢复和 WAV 下载。两种模型均由后台管理专用运行环境。音视频识谱尚未接入。乐谱加工的功能归属见[正式页面交互规则](docs/design/studio.md#midi-与音轨的归属)。

## 乐谱创作与加工

1. 在项目中选择或新建声音片段。
2. 从「导入与 Agent 创作」导入 MIDI / JSON，或复制当前片段的创作要求交给 Agent。导入产生当前片段的新版本。
3. 点击「生成试听音频」将乐谱合成为音频；结果与任务状态留在版本列表。
4. 需要查看音符、选段循环或调整混音时，从版本菜单打开「MIDI 与音轨」。调整后可以「保存为新版本」，原版与成品选择保留。
5. 满意的版本选作成品，下载音频或已有 MIDI；音频转 MIDI 尚未接入。

乐谱工具也支持同片段的对应段落 A/B、保存选段听评、下载完整 JSON 和导出试听 WAV。A/B 的速度与段落长度必须符合对齐条件；普通音频版本仍可从版本列表分别试听比较。工具关闭后停止播放，保存的混音版由后台继续合成。

独立创作包、格式和离线校验器继续可用，见[独立创作说明](src/music/authoring/README.md)。MIDI 不是完整音频，不保存采样音色、效果或本项目的混音；仅有音频的版本不会显示虚假的 MIDI 操作。

## 源码开发

```sh
npm ci
npm run build
npm run serve -- --workspace ~/Music/MusicRoom
```

按终端 URL 打开创作空间。页面需要本地项目服务；`npm run dev` 或静态托管不再提供独立作品库。浏览器历史中的旧乐谱地址会回到新流程。

## 当前作品

| 作品 | 编曲方向 | 文件目录 |
| --- | --- | --- |
| 雨巷来信 · 第一版 | 钢琴器乐，短句较密、和声色彩较丰富 | `public/exports/rain-letter-v1/` |
| 雨巷来信 · 第二版 · Riff | 两小节主题反复出现，以回答句、长音、留白和配器变化推进 | `public/exports/rain-letter-v2/` |

每个目录中的 `song.wav` 是成品，`song.mid` 是 MIDI，`score.json` 是完整乐谱。第一版的乐谱与原始音频已保留，音频 SHA-256 为 `d0fcd5fa75a4ad9a660e8a5af21c649afe3a74246763fdf10910a734f1b3e008`。早期聊天链接指向的 `public/exports/rain-letter.wav` 等文件继续保留。

两个版本均为 96 BPM、4/4、72 小节、180 秒。D 小调起笔，副歌转向 F 大调，尾声回到 D 小调。

| 时间 | 段落 | 第二版的安排 |
| --- | --- | --- |
| 00:00–00:20 | 引子 | 两小节 riff 与不同回答句组成问答 |
| 00:20–01:00 | 主题 A | riff 回来，回答句与配器逐步变化 |
| 01:00–01:20 | 过渡 | 长音与留白，弦乐逐渐进入 |
| 01:20–02:00 | 副歌 | 保留节奏轮廓，抬高旋律、更换回答句 |
| 02:00–02:20 | 间奏 | 主旋律钢琴退场，长笛接过 riff，前半节奏减半 |
| 02:20–02:50 | 再现 | 副歌返回，以新回答和少量八度加强收束 |
| 02:50–03:00 | 尾声 | 撤去节奏组，主题片段与主和弦衰减 |

第二版主旋律从第一版的 414 个音符减为 233 个，有 28 个持续至少 1.6 拍的长音。这些数量用于说明句法调整，不是音乐审美评分。

## 技术与音色

| 层次 | 选择 |
| --- | --- |
| 开发语言与编译器 | TypeScript（Apache-2.0）；项目代码 MIT |
| 演奏、效果、离线渲染 | 浏览器原生 Web Audio |
| 后台渲染 | TypeScript 采样 / PCM 引擎，独立任务进程 |
| 单二进制运行时 | Bun（MIT），仅构建时需要安装 |
| MCP 与服务输入校验 | 官方 MCP TypeScript SDK、Zod（MIT） |
| 开发与静态打包 | Vite（MIT） |
| MIDI 交换 | @tonejs/midi（MIT） |
| 钢琴采样 | Alexander Holm 的 Salamander Grand Piano（CC BY 3.0） |
| 弦乐、长笛采样 | VSCO 2 Community Edition（CC0） |
| 电钢琴、拨弦、贝斯、鼓 | 项目代码合成（MIT） |
| 浏览器验证 | Playwright（Apache-2.0） |

不要求 Python、FluidSynth 或桌面工作站。乐谱 JSON、作曲源码及本地音色共同构成可重建的作品工程；MIDI 单独不保存本项目的音色、效果和混音。

没有订阅或按生成次数收费。钢琴采样需随作品分发保留署名。许可说明见 [署名页](public/credits.html)，来源、固定提交与 SHA-256 见 [资产清单](public/samples/manifest.json)。钢琴使用单一力度层，弦乐与长笛使用部分持续音采样；拨弦是物理建模合成音色，不是真实古筝采样。

## 内置曲目组织与开发接入

| 文件 | 职责 |
| --- | --- |
| `src/catalog.ts` | 歌曲与版本注册、默认版本、明确段落对应关系和目录校验 |
| `src/songs/rain-letter-v1.ts` | 第一版独立乐谱与编曲 |
| `src/songs/rain-letter-v2.ts` | 第二版 riff、回答句与编曲 |
| `src/music/score.ts` | 共用乐谱类型和乐器轨道定义 |
| `src/audio.ts` | 音色加载、合成、播放、混音和离线渲染 |
| `src/midi.ts`、`src/wav.ts` | MIDI 与双声道 PCM WAV 编码 |
| `src/main.ts`、`src/workbench/studio/` | 项目、声音片段、版本与创作入口 |
| `src/workbench/score-editor.ts` | 当前声音版本的乐谱查看、选段、混音、对齐比较与听评 |
| `src/audio/playback.ts` | 循环范围校验与音频时钟位置换算 |

一般新增作品直接在页面导入文件。将作品随静态站点预置时，在 `src/catalog.ts` 的 `WORKS` 注册歌曲 ID 和默认版本；在 `src/songs/` 编写独立作曲函数，并在 `SONGS` 添加带 `workId` 的版本条目。不同曲子可以有不同标题、速度、时长和段落；同一曲子的版本使用独立 ID，以 `workId` 明确归属；不通过标题推断分组。固定 4/4 和统一轨道定义是当前模型的边界。导出路径必须独立，避免覆盖旧作品。

`comparisonSections` 为每个版本配置“共同段落 ID → 乐谱段落索引”；需要比较的段落必须明确对应、长度相同。缺少对应关系的版本仍可单独播放。

MIDI 使用 `englishTitle` 或曲目 ID 保存 ASCII 标题；新段落可用 `midiName` 指定导出标记。中文信息完整保留在页面和 JSON 中。

`npm run export:score` 为注册作品分别生成 MIDI 和 JSON。WAV 在浏览器选择对应作品后导出，默认混音成品保存到该条目的 `files.wav` 位置。新增作品不需要复制页面。

## 验证

```sh
npm run verify:all
```

包括单元测试、构建、后端服务测试、统一创作空间浏览器验证和乐谱工具浏览器验证。浏览器检查默认使用本机 Google Chrome，并在隔离工作目录运行；不会改动用户项目。

`npm run verify:score` 覆盖旧链接定位、当前片段范围、MIDI 下载、选段听评、播放释放、混音新版本与桌面/窄屏布局。截图位于 `test-results/score-context/`。模型生成测试使用测试驱动，不代表新增真实模型推理验收；模型专用真实验证命令继续保留。

旧独立作品库的 `scripts/verify-browser.mjs`、`verify-workbench.mjs`、`verify-imports.mjs`、`verify-loop-audio.mjs`、`verify-comparison.mjs`、`verify-boundaries.mjs`、`verify-service.mjs`、`verify-service-boundaries.test.mjs` 与 `verify-yue2-ui.test.mjs` 为旧页面验证历史，不再作为正式入口验收。核心播放、乐谱、导入与比较规则仍由单元测试覆盖。

`npm run assets` 可以补回缺失音色，复用哈希正确的现有文件。音符编辑、MusicXML、变拍、曲内变速与音频转 MIDI 仍属于后续范围。
