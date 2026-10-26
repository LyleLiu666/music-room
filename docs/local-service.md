# 使用 Music Room 本地程序

## 从内网导航启动（这台 Mac）

打开内网导航 `http://10.144.144.104:9186/start/`，点击 Music Room 即可启动并打开网页。首次点击浏览器可能要求确认打开本机应用。

这台 Mac 的 `~/Applications/Music Room Launcher.app` 注册了 `music-room-local://start`。启动器只接受这个固定动作，调用项目根目录「启动 Music Room.command」，不执行 URL 中传入的命令或参数。命令优先使用 `~/Applications/MusicRoom/music-room`，未安装时才使用项目内的 `release/music-room`。实际服务仍只监听本机；其他设备需有自己的安装才可使用。

重装启动器：运行 `scripts/install-mac-launcher.sh`，需要 Xcode Command Line Tools。启动器依赖当前项目路径；移动项目后重新安装。脚本使用 `~/Music/MusicRoom`，请求端口 57923，重复启动复用现有服务并打开实际地址。导航里的“直接进入网页”用于已启动且位于默认端口的服务。

仍可双击项目根目录的「启动 Music Room.command」。关闭网页不停止服务；停止方式见下文。

## 启动与文件保存

当前交付为 macOS Apple Silicon 命令行二进制，内置服务、网页、基础音色和 MCP。用户无需安装 Node、Bun、Python 或新浏览器运行时。用已有浏览器听评。默认启动的服务独立在后台运行，关闭网页、启动终端或 Agent 连接都不会停止任务。

macOS 调速保存内嵌 Rubber Band 4.0.0 R3 双遍离线程序；源码构建需要 Xcode Command Line Tools，`npm run build` 自动下载并校验固定源码、编译和打包，后续复用经校验的源码缓存。直接运行服务测试前，`npm run test:service` 会先构建该程序；手动运行单个测试可先执行 `npm run build:speed-native`。终端用户不需要编译工具。调速失败会报错，不会静默切回旧算法。独立辅助程序的完整对应源码、构建脚本和 GPL 许可内嵌于 `/speed-native/source.zip`，构建记录位于 `/speed-native/manifest.json`。

```sh
./release/start.sh --workspace "$HOME/Music/MusicRoom" --port 5174
```

启动脚本执行相邻的 `music-room start`，等待后台就绪后打印网页 URL 并退出，在浏览器打开即可。省略 `--port` 会选择空闲端口；省略 `--workspace` 使用 `~/Music/MusicRoom`。重复启动同一工作目录会复用现有服务；若现有服务是前台或旧版程序，启动器会明确提示它仍随所属终端退出，应等任务完成后 `stop` 再 `start`。直接运行 `music-room`（无命令）也默认启动独立后台。日志写入工作目录 `music-room.log`。

关闭启动终端不再停止服务。需要主动退出时使用：

```sh
./release/music-room stop --workspace "$HOME/Music/MusicRoom"
```

停止会中断未完成任务；再次启动恢复项目和已完成音频。开发或进程监督场景可显式使用 `music-room serve` 在前台运行，此时 Ctrl+C 或关闭所属终端会停止服务。电脑关机、重启或强制杀进程仍会中断任务；当前不提供开机自动运行或中断任务自动续算。

本机稳定版可独立安装到 `~/Applications/MusicRoom/`，避免依赖源码目录的构建产物。升级前等待任务结束，停止旧服务，再复制新二进制及启动脚本；原工作目录及模型继续复用。

```sh
mkdir -p "$HOME/Applications/MusicRoom"
cp release/music-room release/start.sh "$HOME/Applications/MusicRoom/"
"$HOME/Applications/MusicRoom/start.sh" --workspace "$HOME/Music/MusicRoom" --port 5174
```

没有 `.app`、安装器、桌面外壳、Developer ID 或公证流程。macOS 可执行文件本身的本地有效性由构建工具处理，不要求用户申请 Apple 开发者账号。

项目在 `projects/<项目 ID>/` 下；版本原件为 `revisions/<版本 ID>/score.json`，后台音频为对应目录中的 `job-….wav`。清理浏览器不会删除项目。停止服务后复制整个工作目录可备份或迁移，模型/运行时无需复制到每个项目。

模型资源与取消、预算、支持范围见[本机模型与资源](model-resources.md)。准备好文件后保持空闲，所有重型任务共用队列。

基础版本支持 MIDI/JSON 导入、短乐句、扩写、多版本、听评、后台渲染和 WAV/MIDI/JSON 导出。YuE2 可在网页选择独立目录后由后台统一安排安装、下载，生成时按需加载，同一能力提供 MCP 工具，见 [YuE2 使用与目录管理](yue2.md)。音视频识谱尚未接入；未准备模型的 YuE2 状态仍显示不可生成。

在首页项目内选择「新声音 → 语音」，可以生成普通语音：填写参考录音文字稿使用 Breeze 4bit，留空沿用 IndexTTS 2.0。参考声音、文字、情绪和每次生成的 WAV 随版本保存到工作目录，支持比较、选择成品和删除恢复。专用 Python 和模型由程序安装，无需手动配置，见 [语音创作](tts.md)。

服务模式下，内置作品与导入作品都使用工作目录保存的乐谱原件；升级程序不会重新作曲替换已有版本。网页演奏、JSON 导出和后台渲染使用同一份乐谱。网页演奏与已保存 WAV 的播放互斥，原生音频控件恢复播放也遵守此规则；切换版本会取消尚未完成的试听请求。

## Agent 的 MCP 连接

推荐 stdio，配置示例中的路径换成你实际保存的位置；网页“本地项目与 MCP”也能复制当前机器的连接配置：

```json
{
  "mcpServers": {
    "music-room": {
      "command": "/absolute/path/music-room",
      "args": ["mcp", "--workspace", "/absolute/path/MusicRoom"]
    }
  }
}
```

`mcp` 优先复用该目录的现有服务；没有服务时自动启动独立后台。不同 Agent 连接共享项目和任务，关闭全部 stdio 连接后后台及已提交任务继续运行。主动停止仍使用 `music-room stop`。

HTTP MCP 地址为启动 URL 加 `/mcp`，采用 Streamable HTTP，带 `Authorization: Bearer <token>`。地址与令牌位于工作目录 `.music-room.runtime.json`，具有私有文件权限；每次服务启动会变化。该文件不是工程内容，不需要交给模型或放入提示词。只在本机监听，无云端上传。

## 创作闭环与工具

MCP 连接说明和音乐生成工具会引导 Agent 先读 `get_music_creation_guide`；也可读取资源 `music-room://music/creation-guide`。两者返回同一份有版本号的指南，无需应用源码，不会启动模型或创建任务。

指南支持 **YuE2 自主作曲** 与 **Agent 写谱 / 改谱后生成音频**，按需求选择，不强制 Agent 重写整曲；不保证减少重复或更好听。内容包含乐器的主奏、回应、伴奏和低音分工、轮番进入与退出、riff 回归变奏、留白与段落发展，以及格式示例、时长和交付检查。可以直接按目标时长创作，短样不是必经步骤。具体音色与轮换是否落实，需要试听确认。

> 使用 Music Room MCP，先读 get_music_creation_guide 和当前声音。按照我的风格与时长要求，结合已有听评选择自主作曲或写谱、改谱后生成音乐。不要承诺能解决重复问题。让乐器有主次、适时轮换，riff 回归要发展，不要直接重复或循环拼接。保留旧版，完成后给我音频试听。

| 操作 | MCP 工具 |
| --- | --- |
| 读取音乐创作手册 | `get_music_creation_guide` |
| 查看声音、版本与当前要求 | `studio_library` |
| 新建项目与声音 | `create_project`、`studio_create_sound` |
| 检查模型状态、读取来源乐谱 | `yue2_status`、`yue2_score` |
| 检查 ABC、时长与上下文 | `yue2_inspect_input` |
| 生成同声音的新版本 | `studio_generate`；写谱或改谱时传入完整 `abc`，自主作曲且未指定乐谱时可省略 |
| 跟踪生成 / 取消指定版本 | `yue2_get_job`（返回版本的 `source.id`）、`studio_cancel` |

### MIDI / JSON 编辑路线

仅在需要音符、音轨编辑或 MIDI 导出时使用 `get_authoring_context`、`validate_score`、`import_revision`、`render_revision` 与 `get_job`。旧资源 `music-room://authoring/guide` 和独立创作包继续提供 MIDI / JSON 格式；该路线的短句阶段不约束 YuE2 完整音乐创作。服务不会执行上传的作曲脚本。

发布新版本需要 JSON 字符串 `compositionJson`，包含 `work.id`、`work.title` 和新的 `revision.id`；扩写时通过 `parentId` 指向同项目旧版。后台渲染提交 `projectId`、`revisionId`、`idempotencyKey` 和可选 `mix`；返回任务字段 `id`，随后用 `get_job` 的 `jobId` 查询。同幂等键与同请求复用原任务，不同请求拒绝；重试用新键。

项目与版本 ID 都以小写英文字母开头，只含小写字母、数字或连字符，最长 64 字符；新建项目与乐谱格式采用同一约束。任务 ID 由服务生成，使用独立规则。

任务 `succeeded` 表示音频已提交且任务记录已保存，`artifact.path` 相对于项目文件夹，`sha256` 可核对原件。任务记录保存失败会明确返回 `failed`；即使音频已经提交，也不隐瞒这个错误。重启会根据项目清单重新关联已提交的音频，并核对输入和产物哈希；没有提交记录、文件缺失或哈希不符都不会恢复成成功。恢复过程中不重新渲染，也不推测丢失的峰值等渲染统计。后台引擎 `sample-pcm-v1` 与浏览器效果处理存在差异；网页可以分别听浏览器演奏和已经保存的后台 WAV。好听与否由用户试听判断。

## 从源码开发与构建

```sh
npm ci
npm run build:binary
npm run verify:binary
```

Bun 1.4.2 是项目内锁定的开发依赖，不更新全局 Bun。产物为 `release/music-room`、`release/start.sh` 和构建记录。当前产物约 114 MiB，包含网页、基础乐器音色和四个 TTS 干人声及预编码特征；不重复嵌入原始 3 分钟 WAV、截图、node_modules 或模型。

二进制构建检查可执行有效性并运行 `--help`；独立验收复制二进制到临时目录、暂时移走松散的 `dist` 资源，并从不包含 Node/Bun 的 PATH 启动，实际调用两种 MCP、渲染 WAV、打开页面和重启恢复。测试最后恢复生成目录。

SDK、解码器与运行时版本变更后必须重跑独立验收。Bun 打包对当前 MP3 库未使用 worker 导出的处理由 `scripts/compile-binary.mjs` 明确限定为同步解码器入口；不会改动 npm 包或解码/WASM 实现。

源代码运行可用 `npm run build`、`npm run serve -- --workspace <目录>`，启动后可关闭终端，此模式使用现有开发 Node 和 `dist`。停止使用 `node src/server/dev.ts stop --workspace <目录>`；需要前台调试时使用 `node src/server/dev.ts serve --workspace <目录>`。服务测试为 `npm run test:service`，浏览器服务验证为 `npm run verify:service`，包含听评保存期间继续编辑/切换版本、保存失败和首次连接失败后的版本链接恢复；静态网页仍可用 `npm run dev`。

产品、存储与逐轮设计见[本地服务方案](design/local-service.md)。音色与组件声明见[署名页](../public/credits.html)和[服务依赖说明](../public/service-licenses.txt)。
