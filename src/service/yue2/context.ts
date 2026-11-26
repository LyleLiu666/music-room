import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {z} from 'zod';
import {generationWithEnding,musicContextStatus,type MusicContext} from './input.ts';
import type {YuE2Generate} from './contracts.ts';
import {durationWithinTarget} from './duration.ts';
import {scoreOperation} from './score.ts';
import type {AssetReader} from '../render/renderer.ts';

// Imports only the frozen protocol and text tokenizer; never loads torch, MLX or weights.
const script=`import json,sys
from yue2.protocol import SongRequest,token_prefixes,GenerationConfig,CONTEXT
from yue2.tokenization_yue2 import YuE2TextTokenizer
data=json.load(sys.stdin)
tokenizer=YuE2TextTokenizer(sys.argv[1])
request=SongRequest(style=data['style'],lyrics=data['lyrics'],abc=data.get('abc'),cot='full')
config=GenerationConfig()
print(json.dumps(dict(prefixTokens=len(token_prefixes(request,tokenizer))+(512 if not request.abc else 0),planningTokens=0 if request.abc else config.abc.max_tokens+2,semanticTokens=config.semantic.max_tokens,contextTokens=CONTEXT)))`;
const count=z.number().int().nonnegative();
const counts=z.object({prefixTokens:count,planningTokens:count,semanticTokens:count,contextTokens:z.literal(24576)});
let pending:Promise<unknown>=Promise.resolve();
/** Serialize the small tokenizer processes so rapid typing cannot create a process burst. */
export function inspectMusicContext(directory:string,input:Pick<YuE2Generate,'style'|'lyrics'|'instrumental'|'ending'|'abc'|'targetDuration'>,read?:AssetReader,scoreMode:'generation'|'exact-score'='generation'):Promise<MusicContext>{
 const abc=input.abc?.trim()?input.abc:undefined;
 const modelInput=generationWithEnding(input);
 const run=pending.then(async()=>{
  let scoreIssue:string|undefined;
  let accompanimentABC:string|undefined;
  const {targetDuration}=input;
  const checkVocal=input.instrumental===false&&!!input.lyrics.trim();
  // Section labels are part of the lyrics format and can be present without any words to sing.
  const hasLyricText=checkVocal&&input.lyrics.split(/\r?\n/).some(line=>line.trim()&&!/^\[[a-z][a-z0-9 _-]*\]$/i.test(line.trim()));
  if(abc&&(checkVocal||targetDuration!==undefined)){
   try{
    const result:{seconds:number;vocalNotes:number;accompanimentABC:string|null}=await scoreOperation({op:'generation',abc:abc.trim(),omitSilentVocal:scoreMode==='generation'&&hasLyricText},read,join(directory,'.venv/bin/python'));
    const {seconds}=result;
    accompanimentABC=result.accompanimentABC??undefined;
    if(checkVocal&&result.vocalNotes===0&&!accompanimentABC){
     if(scoreMode==='exact-score')scoreIssue='ABC 乐谱的人声轨全是休止符。固定乐谱试听需为人声加入音符。';
     else scoreIssue=hasLyricText?'ABC 乐谱的人声和伴奏轨都没有音符。请换一份乐谱，或清空 ABC 乐谱切换为自由规划。':'ABC 乐谱的人声轨全是休止符。填写歌词可使用伴奏轨生成演唱。';
    }else if(targetDuration!==undefined){
     if(!Number.isFinite(seconds)||seconds<=0)scoreIssue='自定义乐谱时长无效，请检查 ABC。';
     else if(!durationWithinTarget(seconds,targetDuration))scoreIssue=`自定义乐谱预计 ${seconds.toFixed(1)} 秒，不符合目标时长 ${targetDuration} 秒（允许偏差 ±30%）。请修改乐谱或选择“由模型决定”。`;
    }
   }catch{
    if(checkVocal)scoreIssue='无法检查演唱 ABC 乐谱的人声轨。请检查谱面格式，或清空 ABC 乐谱切换为自由规划。';
    else if(targetDuration!==undefined)scoreIssue='无法确认自定义乐谱的时长，请检查 ABC 或选择“由模型决定”。';
   }
  }
  return new Promise<MusicContext>((resolve,reject)=>{
   const child=execFile(join(directory,'.venv/bin/python'),['-c',script,join(directory,'models/converted/qwen.tiktoken')],{timeout:10000,maxBuffer:16384},(error,stdout)=>{
    if(error)return reject(new Error('无法检查音乐输入容量，请检查本机音乐模型安装。'));
    try{
     const result=musicContextStatus(counts.parse(JSON.parse(stdout)));
     if(scoreIssue)result.issue=scoreIssue;
     if(accompanimentABC)result.vocalRestsOmitted=true;
     resolve(result);
    }catch{reject(new Error('音乐模型返回的输入容量信息无效。'));}
   });
   child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify({...modelInput,abc:accompanimentABC??abc}));
  });
 });
 pending=run.catch(()=>{});return run;
}
