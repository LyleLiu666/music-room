// Shared by MCP discovery, the read-only guide tool/resource, and the web handoff.
export const musicCreationPrinciples = '默认直接完成目标长度，不强制先做短样；只有用户要求时才做试听片段。没有明确风格或用途时先沟通必要信息。根据完整意图设计主题、变奏、对比与回归；为每段明确主奏、回应、伴奏与低音的角色，合理搭配音区和密度；让乐器轮番进入、接手主题或退出，避免所有乐器从头到尾同时堆叠。riff 每次回归都须做有辨识度的变奏：改变节奏、句尾、音区、和声或接手乐器，同时保留主题联系，不能直接重复。不要仅换音色而让旋律与伴奏机械循环；用留白、对答和段落起伏推动音乐。不机械复制小节凑时长，不把短音频循环拼接成完整版。这些是创作目标与可尝试的方法，不保证减少重复，也不保证更好听；Agent 写谱、改谱或提出变奏要求都不能据此视为已解决问题。配器与演奏细节作为风格要求交给模型，不能保证逐音符精确演奏。';

const abc=`X:1
T:
M:4/4
L:1/32
Q:1/4=100
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:Am
% intro
V: Vocal
"Am"z32|"Dm"z32|"E7"z32|"Am"z32|
V: Ins
A8c8e8c8|d8f8a8f8|e8^g8b8e8|c8B8A16|
`;

export function musicCreationGuide(){return {
 version:2,
 guide:`# Music Room 音乐创作指南

## 创作方式
可以由 YuE2 自主作曲，也可以由 Agent 写谱或根据听评尝试改谱后交给 YuE2。结合用户要求和已有作品选择，不默认要求 Agent 重写整曲，也不根据单次试听认定任一路线普遍更好。改谱时尽量保留用户认可的旋律与听感，但重新生成可能改变这些部分。用户明确选定方式或提供乐谱时应尊重其选择。MIDI / JSON 路线保留给明确需要音符编辑或导出的任务，不作为默认音频交付。

## 作曲与编曲
${musicCreationPrinciples}

## 项目与用户设置
先用 studio_library 读取项目、声音、版本与当前输入，沿用 soundId；修改时 parentId 指向本次选中的来源版本，新版不覆盖旧版和成品。需要新建时使用 create_project、studio_create_sound。保留用户明确指定的风格、时长、纯音乐 / 演唱、歌词、档位、收尾和种子（包括 0），不擅自改为更短或更低质量。未指定的参数依据目标判断，不凭空补成用户要求。
来源音乐已完成时，可用 yue2_score 读取 source.id 对应的原谱，再做主题和结构发展。保持人声与歌词要求：演唱须完整歌词及对应声乐谱；纯音乐的 Vocal 声部用于和弦与休止，旋律写入 Ins。不要把纯音乐的旧隐藏歌词传入生成。

## YuE2 乐谱格式与时长
返回的 example 是合法纯音乐格式的四小节例子，不是待提交的完整作品。ABC 使用 X、T、M、L、Q、V、K 头；声部为 Vocal 和 Ins。每组两个声部对齐、最多四小节；例子的 4/4、L:1/32 格式每小节长度之和为 32。段落用 % intro / verse / chorus / bridge / interlude / outro 等支持的标签，structure 用相应 [标签]。不要使用 theme、variation 等不支持的段落标签。
目标秒数约为小节数 × 每小节拍数 × 60 / BPM。使用合适速度，通过完整主题、变奏、对比和收束安排目标长度，不降低速度凑时间。targetDuration 支持 60/120/180/240/300 秒；乐谱与最终音频都检查 ±15%，例如 240 秒范围为 204–276 秒。自带乐谱不自动改写，不合格须先改谱，不能删掉目标绕过检查。

## 生成与交付
1. yue2_status 检查本机引擎准备状态；不要在已有模型可用时重复安装。
2. yue2_inspect_input 检查 style、lyrics（纯音乐用段落结构）、instrumental、abc、targetDuration、ending 的格式、谱长和上下文。修正明确错误后再提交。
3. studio_generate 使用当前 soundId、parentId、text（风格）、structure 及其他用户设置。选择 YuE2 自主作曲且未指定乐谱时，可省略 abc；选择 Agent 写谱或改谱时传入完整 abc，不擅自丢弃用户提供或认可的谱子。两种方式均不以 MIDI 音源或循环拼接替代成品。
4. 保存返回的版本与 source.id，用 yue2_get_job 跟踪到 done / failed / cancelled。主动取消时用 studio_cancel；失败时先解释原因，不能无界重试。
5. 只有完成后才能交付音频。检查实际时长、截断状态与文件可播放性；保留原版、提供新音频试听。用户听评决定是否满意，文件验证不代表音乐质量合格。

## 能力边界
乐谱能表达具体音符、节奏、和声及结构；音色、乐器轮换和演奏方式可指导但不能保证模型完全照做。目前用户对单曲的反馈是 Agent 编曲变化增多，但整体听感仍不如音乐模型自主创作；这不能证明 Agent 能稳定规避重复，也不能推断固定分工必然更好。旋律好听与结构变化是不同维度，须试听比较，不能用音符或小节不重复代替听感判断。不要声称已经听到或验证了没有实际试听的细节。`,
 example:{style:'Instrumental only, no vocals; nylon-string guitar melody, warm brass answers, sparse bass; light latin groove; 100 BPM',instrumental:true,structure:'[intro]',abc},
 workflow:['studio_library','yue2_status','yue2_score','yue2_inspect_input','studio_generate','yue2_get_job'],
};}
export type MusicCreationGuide=ReturnType<typeof musicCreationGuide>;
