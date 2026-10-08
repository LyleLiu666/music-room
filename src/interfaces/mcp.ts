import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {operations,operationName,parseOperation,type ServiceCaller} from '../service/operations.ts';
export function musicMcp(call:ServiceCaller) {
  const server=new McpServer({name:'music-room',version:'1.0.0'},{instructions:'本地音乐创作工作台。先 get_authoring_context 了解格式和已有项目，写短主题，validate_score 后 import_revision，render_revision 后轮询 get_job。用户试听反馈决定好听与否。不要复用版本 ID，不执行上传源码。'});
  for(const [name,op] of Object.entries(operations)) {
    if(name==='library')continue;
    server.registerTool(name,{description:op.description,inputSchema:op.schema,annotations:{readOnlyHint:['status','list_projects','get_project','get_authoring_context','validate_score','get_revision','get_job','list_jobs'].includes(name),destructiveHint:false,openWorldHint:false}},async (args:Record<string,unknown>)=> {
      try {const key=operationName(name),result=await call(key,parseOperation(key,args));return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};}
      catch(error:any){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:error.code??'INVALID_REQUEST',message:error.message})}]};}
    });
  }
  server.registerResource('authoring-guide','music-room://authoring/guide',{description:'无需应用源码的作曲交付格式及示例',mimeType:'text/plain'},async uri=>{
    const value=await call('get_authoring_context',{});return {contents:[{uri:uri.href,mimeType:'text/plain',text:value.guide}]};
  });
  return server;
}
