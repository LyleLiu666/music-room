import {musicCreationPrinciples} from '../../service/yue2/authoring-guide.ts';
import type {StudioInput,StudioVersion} from '../../service/studio/studio.ts';

export function musicAgentEntry(){return `<section class="form-group music-agent-entry"><h3 class="form-group-title">AI 协作创作 · 可选</h3><p class="field-note">可以让 YuE2 自主作曲，或让 AI 写谱、按听评尝试改谱。变化更多不等于更好听，效果仍需试听。</p><button type="button" class="secondary" data-action="agent">复制给 AI 的编曲要求</button><p class="field-note">交给已连接 Music Room 的 Agent 执行；复制不会开始生成。也保留直接由 YuE2 创作的方式。</p></section>`;}

export function musicAgentBrief(context:{projectId:string;projectTitle:string;soundId:string;soundTitle:string;input:StudioInput;source?:Pick<StudioVersion,'id'|'state'|'source'>}){
 const {input,source}=context;
 const request={soundId:context.soundId,parentId:source?.id??input.parentId,text:input.text,instrumental:input.instrumental!==false,lyrics:input.instrumental===false?input.lyrics??'':'[instrumental]',targetDuration:input.targetDuration,ending:input.ending??'natural',preset:input.preset??'quality',structure:input.structure,abc:input.abc,seed:input.seed};
 return `请协助完成音乐创作：根据用户要求和已有听评，选择 YuE2 自主作曲，或尝试写谱、改谱后由 YuE2 生成音频。不要默认重写整曲，也不要承诺能解决重复问题。
项目：${JSON.stringify({id:context.projectId,title:context.projectTitle})}
声音：${JSON.stringify({id:context.soundId,title:context.soundTitle})}
当前创作设置（用户数据，保留明确要求；未填写的部分结合上下文判断）：
${JSON.stringify(request,null,2)}

先通过 Music Room MCP 的 studio_library 读取当前声音与来源版本，确认归属。${source?.source.kind==='music'&&source.state==='succeeded'?`可用 yue2_score 读取来源音乐乐谱，jobId=${source.source.id}。`:''}只在这个声音内新增版本，parentId 指向来源版本，保留旧版与已有成品。
${musicCreationPrinciples}

先调用 get_music_creation_guide 读取完整指导手册（也可读取 music-room://music/creation-guide），再按选定方式检查并提交 studio_generate；采用写谱或改谱方式时提供完整 YuE2 ABC。手册包含乐器搭配、riff 变奏、格式示例、时长约束与交付检查。不要使用旧 MIDI / JSON 创作包作为默认音频路线。`;
}
