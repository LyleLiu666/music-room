import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {operations,operationName,parseOperation,type ServiceCaller} from '../service/operations.ts';
export function musicMcp(call:ServiceCaller) {
  const server=new McpServer({name:'music-room',version:'1.0.0'},{instructions:'本地音乐创作工作台。乐谱路线：先 get_authoring_context 了解格式和已有项目，写短主题，validate_score 后 import_revision，render_revision 后轮询 get_job。YuE2 音频路线：先 yue2_status，用户指定目录后 prepare_yue2 安装并启动，轮询就绪后 yue2_generate，用 yue2_get_job 查询到 done 并读取 audioPath。IndexTTS 2.0 语音路线：先 tts_status/tts_prepare 准备模型，tts_add_voice 保存参考人声并默认后台清理，轮询 tts_library 的 voices.processing 到 succeeded 后复用；已干净素材可 cleanup=false，tts_update_voice 可标记常用。tts_create_sound 在项目下创建语音，tts_generate 生成后用 tts_get_version 查询；成功 WAV 在工作目录 speech/audio/<版本 id>.wav，也可通过受令牌保护的 /speech/audio/<版本 id> 下载。各引擎与任务状态不同，音频不会自动转为 MIDI。用户试听反馈决定好听与否。不要复用版本 ID，不执行上传源码。'});
  for(const [name,op] of Object.entries(operations)) {
    if(name==='library')continue;
    server.registerTool(name,{description:op.description,inputSchema:op.schema,annotations:{readOnlyHint:['status','list_projects','get_project','get_authoring_context','validate_score','get_revision','get_job','list_jobs','yue2_status','yue2_get_job','yue2_list_jobs','tts_status','tts_library','tts_get_version'].includes(name),destructiveHint:name==='stop_yue2'||name==='yue2_cancel_job',openWorldHint:name==='prepare_yue2'||name==='tts_prepare'}},async (args:Record<string,unknown>)=> {
      try {const key=operationName(name),result=await call(key,parseOperation(key,args));return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};}
      catch(error:any){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:error.code??'INVALID_REQUEST',message:error.message})}]};}
    });
  }
  server.registerResource('authoring-guide','music-room://authoring/guide',{description:'无需应用源码的作曲交付格式及示例',mimeType:'text/plain'},async uri=>{
    const value=await call('get_authoring_context',{});return {contents:[{uri:uri.href,mimeType:'text/plain',text:value.guide}]};
  });
  return server;
}
