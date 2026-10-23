# 2026-10-23 原提示词规划失败回归

返回[测试入口](../testing.md)。本记录针对 `MUSIC-PLAN-02`，不替代此前全项目验收或人工听评。

## 缺陷与修复

原始输入为 `Instrumental piano miniature, concise melody, natural ending, no vocals.`，歌词为 `[instrumental]`，纯音乐、fast、自然收尾、seed 42、自动时长；不提供乐谱。固定输入保存在 `tests/quality/music-planning-regression.json`。包含产品原有器乐与收尾指导的模型输入 SHA-256 为 `336e59f5bbb3ae19e071e92637a6d9aeef3bb1cb268d4d1b242a8ca089ed2ec7`，单元回归固定该值。

旧版本三次规划都生成重复乐句，直到耗尽 4096 token。原恢复逻辑追加纠错文字，却保持相同采样设置，本例无法脱离重复输出。修复保持首轮行为；只有乐谱截断或无效时，后续两轮逐步提高采样多样性与重复惩罚，提示词及歌词原样保留。首轮 seed 42、后续 43 / 44 的既有规则、三次尝试上限、输出预算与系统资源保护保持不变。

完整有效乐谱仍直接进入合成，不因偏离目标时长而重写或截断。取消、三次失败和用户自带乐谱仍遵循原边界。采样恢复策略纳入检查点指纹；旧策略留下的恢复点不能冒充新策略产物，不匹配时需从头生成。

## 本次证据

证据均位于忽略目录 `test-results/music-planning/`，首次失败不会被后续结果覆盖。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 旧版本真实复现 | 三次均截断，各 4096 token；除新任务 ID 外，三轮模型输入与乐谱均和历史失败一致 | `run-1792737532593/verification.json`、`baseline-reproduction.json` |
| 先失败的单元回归 | 新增恢复断言在旧逻辑下失败，修复后通过 | `sampling-red.log`、`sampling-green.log`、`duration-tests.log` |
| 修复版源码首次执行 | 第二轮 1629 token 生成完整乐谱，预计 173.33 秒；后续合成被系统持续交换写出保护终止，不计完整通过 | `run-1792737897164/verification.json`、`fixed-source-pressure.log` |
| 修复版源码完整复验 | 退出码 0；第二轮规划完成，完整合成、有限非静音及未截断检查通过；产出的 FLAC 与独立包逐字节一致 | `run-1792739498005/verification.json`、`source-final.log`、`final-verification.json` |
| 修复版独立包 | 第二轮完整，1629 token；两轮输入指纹均与原输入相同，乐谱与源码版一致。完成真实 MLX 推理，183.079 秒、48 kHz 双声道 FLAC；规划与语义生成均未截断，下载字节一致，Chrome 播放通过，截图已核查 | `binary-original/verification.json`、`planning-verification.json`、`artifact-audit.json`、`generated.png` |
| 日常全量回归 | `verify:all` 退出码 0：单元 89、服务 343、Chrome 64 + 3、歌词 Python 12、实验 Python 14 / Node 8；Node 套件均无失败与跳过 | `verify-all.log` |
| 独立包基本验收 | 16 项通过；不依赖外置 `dist/`，验证真实乐谱渲染、调速保存、MCP、播放及重启恢复 | `verify-binary.log`、`binary-package/` |

独立包 SHA-256 为 `9c5a184e56fac0045f48c6da6ab7d97db6de1f558d21062d0e829cf088c6c1f9`。实际推理仍使用正式资源策略；首次内存保护失败保留，没有放宽阈值。

源码与独立包的原输入完整回归均通过，临时服务和模型进程已关闭。提交前复核 466 个源码 / 测试 / 资源文件与验收记录一致。服务替换记录单独保存在 `test-results/deployment-planning-2026-10-23/`，包含程序备份、数据哈希和启动后检查。

该回归证明特定原输入的规划与生成行为；有限、非静音、可下载和可播放不等于音乐审美或自然收尾已经通过人工听评。此前的人工质量验收仍保持待完成。
