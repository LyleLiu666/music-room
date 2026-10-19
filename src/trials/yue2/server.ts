import {createServer} from 'node:http';
import {createReadStream,existsSync,readFileSync,mkdirSync,openSync,closeSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Trials} from './trials.ts';
import {ZodError} from 'zod';
import {createRunner} from './runner.ts';
export async function startTrials({directory=join(homedir(),'Music/MusicRoom/experiments/yue2'),root=join(homedir(),'Music/YuE2'),port=4321,runner=createRunner(root)}={}){
 mkdirSync(directory,{recursive:true});const lock=join(directory,'server.lock');
 if(existsSync(lock)){const pid=Number(readFileSync(lock,'utf8'));let alive=true;try{process.kill(pid,0);}catch(e:any){if(e.code==='ESRCH')alive=false;}if(alive)throw Error('试用服务已经在运行');unlinkSync(lock);}
 const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
 const trials=new Trials(directory),token=randomBytes(32).toString('hex');let origin='';
 const server=createServer(async(req,res)=>{try{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.headers.host!==new URL(origin).host)throw Error('非法服务地址');
  const url=new URL(req.url??'/',origin);
  const json=(v:unknown)=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(v));};
  if(req.method==='POST'){
   if(req.headers.origin!==origin||req.headers['x-trial-token']!==token||req.headers['content-type']!=='application/json')throw Error('请求来源无效，请刷新试用页');
   let body='';for await(const part of req){body+=part;if(body.length>500000)throw Error('请求内容过长');}const b=JSON.parse(body);
   if(url.pathname==='/api/import')return json(await trials.importScore(b.abc,b.input));
   if(url.pathname==='/api/transfer')return json(await trials.transfer(b.id,b.hash,b.overlap,b.style));
   if(url.pathname==='/api/proposal')return json(await trials.propose(b.id,b.hash,b.abc,b.kind));
   if(url.pathname==='/api/section')return json(await trials.section(b.id,b.hash,b.index,b.action));
   if(url.pathname==='/api/brief')return json(trials.brief(b.id,b.hash,b.kind,b.instruction));
   if(url.pathname==='/api/feedback'){trials.feedback(b.id,b.value);return json({ok:true});}
   if(url.pathname==='/api/jobs'){if(!['plan','render'].includes(b.kind))throw Error('任务类型无效');return json(trials.start(b.kind,b.input,b.id,b.hash,runner.run));}
   if(url.pathname==='/api/cancel'){trials.cancel(b.id);return json({ok:true});}
  }
  if(req.method!=='GET'){res.statusCode=404;return res.end();}
  if(url.pathname==='/api/state')return json({token,directory,...trials.snapshot()});
  if(url.pathname==='/api/resources')return json(await runner.status());
  if(url.pathname.startsWith('/api/score/')){const v=trials.version(url.pathname.slice('/api/score/'.length));res.setHeader('Content-Type','text/plain; charset=utf-8');return res.end(v.abc);}
  if(url.pathname.startsWith('/api/audio/')){const id=url.pathname.slice('/api/audio/'.length);const job=trials.snapshot().jobs.find(j=>j.id===id&&j.kind==='render'&&j.status==='succeeded');if(!job)throw Error('音频尚未生成');res.setHeader('Content-Type','audio/flac');return createReadStream(join(directory,'jobs',job.id,'song/audio.flac')).pipe(res);}
  if(url.pathname==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="yue2-trials.json"');return json(trials.snapshot());}
  if(url.pathname==='/'||url.pathname==='/plan'){res.writeHead(302,{Location:'/transfer'});return res.end();}
  const assets:Record<string,[string,string]>={'/transfer':['page.html','text/html'],'/edit':['page.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
  const asset=assets[url.pathname];if(asset){res.setHeader('Content-Type',asset[1]+'; charset=utf-8');return res.end(readFileSync(new URL('./'+asset[0],import.meta.url)));}
  res.statusCode=404;res.end('Not found');
 }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:e instanceof ZodError?e.issues.map(i=>i.message).join('；'):(e as Error).message}));}});
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin=`http://127.0.0.1:${(server.address() as any).port}`;resolve();});});}catch(e){unlinkSync(lock);await runner.close();throw e;}
 return {url:origin,trials,close:async()=>{await trials.close();await runner.close();await new Promise<void>(r=>server.close(()=>r()));unlinkSync(lock);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await startTrials({directory:process.env.MUSIC_TRIAL_DIRECTORY,root:process.env.MUSIC_TRIAL_ENGINE,port:Number(process.env.MUSIC_TRIAL_PORT??4321)});console.log('YuE2 独立试用：'+app.url+'/transfer');
 let closing=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(!closing){closing=true;void app.close().then(()=>process.exit(0));}});
}
