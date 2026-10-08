# 使用 Music Room 本地程序

## 启动与文件保存

当前交付为 macOS Apple Silicon 命令行二进制，内置服务、网页、基础音色和 MCP。用户无需安装 Node、Bun、Python 或新浏览器运行时。用已有浏览器听评，关闭网页不会停止独立启动的后台。

```sh
./release/start.sh --workspace "$HOME/Music/MusicRoom" --port 5174
```

启动脚本仅执行相邻的 `music-room serve`；也可直接运行二进制。终端打印网页 URL，在浏览器打开即可。省略 `--port` 会选择空闲端口；省略 `--workspace` 使用 `~/Music/MusicRoom`。Ctrl+C 停止后台并中断未完成任务；再次启动恢复项目和已完成音频。

没有 `.app`、安装器、桌面外壳、Developer ID 或公证流程。macOS 可执行文件本身的本地有效性由构建工具处理，不要求用户申请 Apple 开发者账号。

项目在 `projects/<项目 ID>/` 下；版本原件为 `revisions/<版本 ID>/score.json`，后台音频为对应目录中的 `job-….wav`。清理浏览器不会删除项目。停止服务后复制整个工作目录可备份或迁移，模型/运行时无需复制到每个项目。

基础版本支持 MIDI/JSON 导入、短乐句、扩写、多版本、听评、后台渲染和 WAV/MIDI/JSON 导出。音视频导入、音频识谱、YuE2 生成尚未接入，MCP 状态如实显示不可用。本轮不会下载大模型。

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

`mcp` 优先复用该目录的现有服务；没有服务时自动启动。不同 agent 连接共享项目和任务。若由 stdio 连接启动服务，关闭该拥有者连接会停止它；需要任务在 agent 退出后继续时，先用启动脚本运行服务。

HTTP MCP 地址为启动 URL 加 `/mcp`，采用 Streamable HTTP，带 `Authorization: Bearer <token>`。地址与令牌位于工作目录 `.music-room.runtime.json`，具有私有文件权限；每次服务启动会变化。该文件不是工程内容，不需要交给模型或放入提示词。只在本机监听，无云端上传。

## 创作闭环与工具

先对 agent 说：

> 使用 music-room MCP。先读取项目和独立创作资料，为我的项目写八小节器乐主题，有明确 riff、回答和留白，避免机械重复。校验后导入为新版本并渲染，查询任务直至完成；告诉我版本和试听产物位置。根据我后面的听评扩写，保留父版，不能覆盖旧版。

| 操作 | MCP 工具 |
| --- | --- |
| 查看能力和作品 | `status`、`list_projects`、`get_project` |
| 新建项目与获取资料 | `create_project`、`get_authoring_context` |
| 校验和发布新版本 | `validate_score`、`import_revision` |
| 获取原件、来源和音频清单 | `get_revision` |
| 提交后台渲染 | `render_revision` |
| 查询或取消 | `list_jobs`、`get_job`、`cancel_job` |
| 保存听评 | `add_feedback` |

独立创作格式另有 MCP 资源 `music-room://authoring/guide`。创作包与示例同时内嵌在网页供下载，不需要应用源码。服务不会执行上传的作曲脚本，agent 可在自己的环境使用任意语言写乐谱。

发布新版本需要 JSON 字符串 `compositionJson`，包含 `work.id`、`work.title` 和新的 `revision.id`；扩写时通过 `parentId` 指向同项目旧版。后台渲染提交 `projectId`、`revisionId`、`idempotencyKey` 和可选 `mix`；返回任务字段 `id`，随后用 `get_job` 的 `jobId` 查询。同幂等键与同请求复用原任务，不同请求拒绝；重试用新键。

项目与版本 ID 都以小写英文字母开头，只含小写字母、数字或连字符，最长 64 字符；新建项目与乐谱格式采用同一约束。任务 ID 由服务生成，使用独立规则。

任务 `succeeded` 才完成写盘，`artifact.path` 相对于项目文件夹，`sha256` 可核对原件。失败或中断不算成功。后台引擎 `sample-pcm-v1` 与浏览器效果处理存在差异；网页可以分别听浏览器演奏和已经保存的后台 WAV，不会将它冒充旧版原始成品。好听与否由用户试听判断。

## 从源码开发与构建

```sh
npm ci
npm run build:binary
npm run verify:binary
```

Bun 1.4.2 是项目内锁定的开发依赖，不更新全局 Bun。产物为 `release/music-room`、`release/start.sh` 和构建记录。当前产物约 81 MiB，包含约 20 MiB 音色与页面资源；不重复嵌入原始 3 分钟 WAV、截图、node_modules 或模型。

二进制构建检查可执行有效性并运行 `--help`；独立验收复制二进制到临时目录、暂时移走松散的 `dist` 资源，并从不包含 Node/Bun 的 PATH 启动，实际调用两种 MCP、渲染 WAV、打开页面和重启恢复。测试最后恢复生成目录。

SDK、解码器与运行时版本变更后必须重跑独立验收。Bun 打包对当前 MP3 库未使用 worker 导出的处理由 `scripts/compile-binary.mjs` 明确限定为同步解码器入口；不会改动 npm 包或解码/WASM 实现。

源代码运行可用 `npm run build`、`npm run serve -- --workspace <目录>`，此模式使用现有开发 Node 和 `dist`。服务测试为 `npm run test:service`，浏览器服务验证为 `npm run verify:service`；静态网页仍可用 `npm run dev`。

产品、存储与逐轮设计见[本地服务方案](design/local-service.md)。音色与组件声明见[署名页](../public/credits.html)和[服务依赖说明](../public/service-licenses.txt)。
