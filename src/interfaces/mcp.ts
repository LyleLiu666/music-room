import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {operations,operationName,parseOperation,type ServiceCaller} from '../service/operations.ts';
export function musicMcp(call:ServiceCaller) {
  const server=new McpServer({name:'music-room',version:'1.0.0'},{instructions:'本地音乐创作工作台。音乐创作或改编先调用只读 get_music_creation_guide（资源 music-room://music/creation-guide），无需应用源码即可获得完整指导手册。可由 YuE2 自主作曲，也可由 Agent 写谱或按听评尝试改谱，不默认重写整曲，不保证减少重复或改善听感；乐器要有主次、搭配和轮换，riff 回归要变奏，不能直接重复。不强制先做短样，可直接按目标时长创作。先 studio_library 确认声音归属，yue2_inspect_input 检查后 studio_generate 提交；写谱或改谱时提供完整 abc，用 yue2_get_job 跟踪 source.id 到 done；保留旧版。MIDI / JSON 编辑与导出任务才使用 get_authoring_context 及对应音源渲染。IndexTTS 2.0 语音路线：先 tts_status/tts_prepare 准备模型，tts_add_voice 保存参考人声并默认后台清理，轮询 tts_library 的 voices.processing 到 succeeded 后复用；已干净素材可 cleanup=false，tts_update_voice 可标记常用。tts_create_sound 在项目下创建语音，tts_generate 生成后用 tts_get_version 查询；成功 WAV 在工作目录 speech/audio/<版本 id>.wav，也可通过受令牌保护的 /speech/audio/<版本 id> 下载。各引擎与任务状态不同，音频不会自动转为 MIDI。可用 resource_status 查询所有引擎共享的队列与资源；取消、暂停和预算收紧也通过统一资源接口。用户试听反馈决定好听与否。不要复用版本 ID，不执行上传源码。'});
  for(const [name,op] of Object.entries(operations)) {
    if(name==='library')continue;
    server.registerTool(name,{description:op.description,inputSchema:op.schema,annotations:{readOnlyHint:['get_music_creation_guide','resource_status','status','list_projects','get_project','get_authoring_context','validate_score','get_revision','get_job','list_jobs','yue2_status','yue2_get_job','yue2_list_jobs','tts_status','tts_library','tts_get_version','svc_library'].includes(name),destructiveHint:name==='resource_cancel'||name==='stop_yue2'||name==='yue2_cancel_job',openWorldHint:name==='prepare_yue2'||name==='tts_prepare'}},async (args:Record<string,unknown>)=> {
      try {const key=operationName(name),result=await call(key,parseOperation(key,args));return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};}
      catch(error:any){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:error.code??'INVALID_REQUEST',message:error.message})}]};}
    });
  }
  server.registerResource('authoring-guide','music-room://authoring/guide',{description:'MIDI / JSON 乐谱编辑与音源合成格式；音乐音频创作请读 music-room://music/creation-guide',mimeType:'text/plain'},async uri=>{
    const value=await call('get_authoring_context',{});return {contents:[{uri:uri.href,mimeType:'text/plain',text:value.guide}]};
  });
  server.registerResource('music-creation-guide','music-room://music/creation-guide',{description:'音乐创作指导手册：方式选择、乐器轮换、riff 变奏尝试、效果边界与交付',mimeType:'application/json'},async uri=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(await call('get_music_creation_guide',{}))}]}));
  return server;
}
