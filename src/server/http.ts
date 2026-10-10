import {BufferGate,importRequest} from './resource-io.ts';
import {conversionUploadLimit} from '../service/conversion/conversion.ts';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {musicMcp} from '../interfaces/mcp.ts';
import {operationName,parseOperation} from '../service/operations.ts';
import {ServiceError} from '../service/projects/store.ts';
import type {MusicService} from '../service/service.ts';
export type WebAssets = {read:(path:string)=>Promise<Uint8Array>;has:(path:string)=>boolean;embedded:boolean};
export type Runtime = {pid:number;url:string;token:string;workspace:string;command:string;args:string[]};
const mime=(p:string)=>p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':p.endsWith('.json')?'application/json':p.endsWith('.mp3')?'audio/mpeg':p.endsWith('.wav')?'audio/wav':p.endsWith('.mid')?'audio/midi':p.endsWith('.zip')?'application/zip':'text/plain; charset=utf-8';
async function jsonBody(req:IncomingMessage) {const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>5*1024*1024)throw new ServiceError('TOO_LARGE','请求超过 5 MiB');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const json=(res:ServerResponse,status:number,value:unknown)=> {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
export async function serveHttp(service:MusicService,assets:WebAssets,port=0,command=process.execPath,args:string[]=[]) {
  const audioBuffers=new BufferGate(1),jsonBuffers=new BufferGate(4);
  const token=randomBytes(32).toString('hex');let runtime:Runtime;
  const server=createServer(async(req,res)=> {
    const controller=new AbortController();const disconnect=()=>{if(!res.writableFinished)controller.abort(new Error('客户端已断开'));};req.once('aborted',disconnect);res.once('close',disconnect);
    const readJSON=()=>jsonBuffers.run(controller.signal,()=>jsonBody(req));
    const audio=async(contentType:string,read:()=>Uint8Array|Promise<Uint8Array>,filename?:string,disposition='inline')=>audioBuffers.run(controller.signal,async()=>{const bytes=await read();controller.signal.throwIfAborted();res.writeHead(200,{'content-type':contentType,'content-length':bytes.length,'cache-control':'no-store',...(filename?{'content-disposition':`${disposition}; filename="${filename}"`}:{})});await new Promise<void>(resolve=>{const finish=()=>{res.off('finish',finish);res.off('close',finish);resolve();};res.once('finish',finish);res.once('close',finish);res.end(bytes);});});
    try {
      const origin=runtime.url;
      if(req.headers.host!==new URL(origin).host || req.headers.origin && req.headers.origin!==origin){json(res,403,{code:'FORBIDDEN_ORIGIN',message:'来源不允许'});return;}
      const url=new URL(req.url??'/',origin),path=decodeURIComponent(url.pathname);
      const protectedRoute=path.startsWith('/api/') || path==='/mcp' || path.startsWith('/artifacts/')||path.startsWith('/yue2-audio/')||path.startsWith('/speech/')||path.startsWith('/studio-audio/')||path.startsWith('/tts-presets/')||path.startsWith('/conversion/');
      if(protectedRoute) {
        const candidate=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
        if(candidate.length!==expected.length || !timingSafeEqual(candidate,expected)){json(res,401,{code:'UNAUTHORIZED',message:'需要本地访问令牌'});return;}
      }
      if(path==='/mcp') {
        if(req.method!=='POST'){res.writeHead(405,{allow:'POST'});res.end();return;}
        const body=await readJSON();
        const mcp=musicMcp(service.call);
        const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
        res.on('close',()=>{void transport.close();void mcp.close();});
        await mcp.connect(transport);await transport.handleRequest(req,res,body);return;
      }
      if(path==='/conversion/upload') {
        if(req.method!=='POST'){json(res,405,{message:'请用 POST'});return;}
        const voiceId=url.searchParams.get('voiceId')??'',pitch=url.searchParams.get('pitchShiftSemitones');const pitchShiftSemitones=pitch===null?0:pitch.trim()?Number(pitch):NaN;
        const job=await importRequest(service.resources,req,conversionUploadLimit,controller.signal,(bytes,signal)=>service.studio.uploadConversion({pitchShiftSemitones,soundId:url.searchParams.get('soundId')??undefined,parentId:url.searchParams.get('parentId')??undefined,name:url.searchParams.get('name')??'',bytes,voiceId,requestId:url.searchParams.get('requestId')??''},signal));json(res,200,job);return;
      }
      if(path.startsWith('/conversion/audio/')) {
        if(req.method!=='GET'){json(res,405,{message:'请用 GET'});return;}
        const parts=path.slice('/conversion/audio/'.length).split('/');if(parts.length!==2||!['original','source','converted','vocals'].includes(parts[1]))throw new ServiceError('NOT_FOUND','音频不存在');
        const [id,kind]=parts,job=service.conversion.get(id);
        const contentType=kind!=='original'?'audio/wav':({'.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac','.aif':'audio/aiff','.aiff':'audio/aiff'}[job.extension]??'application/octet-stream');
        await audio(contentType,()=>service.studio.conversionAudio(id,kind as 'original'|'source'|'converted'|'vocals'),`${id}-${kind}${kind==='original'?job.extension:'.wav'}`);return;
      }
      if(path==='/speech/voices') {
        if(req.method!=='POST'){json(res,405,{message:'请用 POST'});return;}
        const voice=await jsonBuffers.run(controller.signal,async()=>{
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024)throw new ServiceError('TOO_LARGE','参考声音不能超过 6 MiB');chunks.push(chunk);}
        const cleanup=url.searchParams.get('cleanup');if(cleanup!==null&&!['true','false'].includes(cleanup))throw new ServiceError('INVALID_REQUEST','cleanup 必须是 true 或 false');
        return service.speech.addVoice(url.searchParams.get('name')??'参考声音',Buffer.concat(chunks),cleanup!=='false');        });json(res,200,voice);return;
      }
      if(path.startsWith('/speech/audio/')||path.startsWith('/speech/voice-audio/')) {
        if(req.method!=='GET'){json(res,405,{message:'请用 GET'});return;}
        const voice=path.startsWith('/speech/voice-audio/'),id=path.slice(voice?20:14);await audio('audio/wav',()=>voice?service.speech.voiceAudio(id,url.searchParams.get('original')==='true'):service.speech.audio(id),`${id}.wav`);return;
      }
      if(path.startsWith('/studio-audio/')) {
        if(req.method!=='GET'){json(res,405,{message:'请用 GET'});return;}
        await audio('audio/wav',()=>service.studio.audio(path.slice('/studio-audio/'.length)));return;
      }
      if(path.startsWith('/api/')) {
        if(req.method!=='POST'){json(res,405,{message:'请用 POST'});return;}
        const name=operationName(path.slice(5)),args=parseOperation(name,await readJSON());json(res,200,await service.call(name,args));return;
      }
      if(path.startsWith('/artifacts/')) {
        if(req.method!=='GET'){json(res,405,{message:'请用 GET'});return;}
        const parts=path.slice(11).split('/');if(parts.length!==3)throw new ServiceError('NOT_FOUND','产物不存在');
        await audio('audio/wav',async()=>(await service.store.artifact(parts[0],parts[1],parts[2])).bytes,`${parts[2]}.wav`,'attachment');return;
      }
      if(path.startsWith('/yue2-audio/')) {
        if(req.method!=='GET'){json(res,405,{message:'请用 GET'});return;}
        const id=path.slice(12);await audio('audio/flac',()=>service.yue2Client.audio(id));return;
      }
      if(req.method!=='GET' && req.method!=='HEAD'){json(res,405,{message:'方法不支持'});return;}
      const asset=path==='/'?'index.html':path.slice(1);
      if(!asset || asset.split('/').some(s=>s==='..'||s==='.') || asset.includes('\\') || !assets.has(asset)){json(res,404,{message:'文件不存在'});return;}
      if(req.method==='GET'&&(asset.endsWith('.wav')||asset.endsWith('.mp3'))){await audio(mime(asset),()=>assets.read(asset));return;}
      let bytes=await assets.read(asset);
      if(asset==='index.html'||asset==='speech.html'||asset==='score.html'||asset==='conversion.html') {
        const bootstrap={token,url:runtime.url,workspace:runtime.workspace,mcp:{mcpServers:{'music-room':{command:runtime.command,args:[...runtime.args,'mcp','--workspace',runtime.workspace]}}}};
        const html=new TextDecoder().decode(bytes).replace('</head>',`<script type="application/json" id="music-room-service">${JSON.stringify(bootstrap).replace(/</g,'\\u003c')}</script></head>`);bytes=new TextEncoder().encode(html);
      }
      res.writeHead(200,{'content-type':mime(asset),'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff',
        'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:bytes);
    } catch(error:any) {if(!req.complete){if(!res.headersSent)res.setHeader('connection','close');req.resume();}if(!res.headersSent)json(res,error.code==='NOT_FOUND'?404:error.code==='CONFLICT'?409:400,{code:error.code??'INVALID_REQUEST',message:error.message});else res.end();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('服务地址不可用');
  runtime={pid:process.pid,url:`http://127.0.0.1:${address.port}`,token,workspace:service.store.root,command,args};
  let closing:Promise<void>|undefined;
  return {runtime,close:()=>closing??=new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.closeIdleConnections();server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());})};
}
