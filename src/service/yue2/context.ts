import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {z} from 'zod';
import {generationWithEnding,musicContextStatus,type MusicContext} from './input.ts';
import type {YuE2Generate} from './contracts.ts';

// Imports only the frozen protocol and text tokenizer; never loads torch, MLX or weights.
const script=`import json,sys
from yue2.protocol import SongRequest,token_prefixes,GenerationConfig,CONTEXT
from yue2.tokenization_yue2 import YuE2TextTokenizer
data=json.load(sys.stdin)
tokenizer=YuE2TextTokenizer(sys.argv[1])
request=SongRequest(style=data['style'],lyrics=data['lyrics'],abc=data.get('abc'),cot='full')
config=GenerationConfig()
print(json.dumps(dict(prefixTokens=len(token_prefixes(request,tokenizer)),planningTokens=0 if request.abc else config.abc.max_tokens+2,semanticTokens=config.semantic.max_tokens,contextTokens=CONTEXT)))`;
const count=z.number().int().nonnegative();
const counts=z.object({prefixTokens:count,planningTokens:count,semanticTokens:count,contextTokens:z.literal(24576)});
let pending:Promise<unknown>=Promise.resolve();
/** Serialize the small tokenizer processes so rapid typing cannot create a process burst. */
export function inspectMusicContext(directory:string,input:Pick<YuE2Generate,'style'|'lyrics'|'instrumental'|'ending'|'abc'>):Promise<MusicContext>{
 const payload=JSON.stringify({...generationWithEnding(input),abc:input.abc?.trim()?input.abc:undefined});
 const run=pending.then(()=>new Promise<MusicContext>((resolve,reject)=>{
  const child=execFile(join(directory,'.venv/bin/python'),['-c',script,join(directory,'models/converted/qwen.tiktoken')],{timeout:10000,maxBuffer:16384},(error,stdout)=>{
   if(error)return reject(new Error('无法检查音乐输入容量，请检查本机音乐模型安装。'));
   try{resolve(musicContextStatus(counts.parse(JSON.parse(stdout))));}catch{reject(new Error('音乐模型返回的输入容量信息无效。'));}
  });
  child.stdin?.on('error',()=>{});child.stdin?.end(payload);
 }));
 pending=run.catch(()=>{});return run;
}
