import {existsSync,readFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {hash,identity,type ProjectStore} from '../projects/store.ts';
import {scoreOperation,type ScoreSummary} from '../yue2/score.ts';
import {generationWithEnding} from '../yue2/input.ts';
import type {AssetReader} from '../render/renderer.ts';
import type {StudioInput,StudioVersion} from './studio.ts';
export const musicEditKinds=['transfer','harmony','tempo','section'] as const;
export type MusicEditKind=typeof musicEditKinds[number];
export const musicEditLabels:Record<MusicEditKind,string>={transfer:'器乐演奏版',harmony:'和弦修改版',tempo:'速度改谱版',section:'段落修改版'};
export type MusicEditChange={kind:'transfer';overlap:'error'|'vocal'}|{kind:'harmony';abc:string}|{kind:'tempo';bpm:number}|{kind:'section';index:number;action:'repeat'|'delete'};
export type MusicEditProvenance={draftId:string;revision:number;label:string;sourceHash:string};
export type MusicEditSource={version:StudioVersion;abc:string};
export type MusicEditDraft={id:string;kind:MusicEditKind;revision:number;sourceVersionId:string;sourceNumber:number;sourceHash:string;sourceAbc:string;sourceInput:StudioInput;summary:ScoreSummary;candidate?:{abc:string;summary:ScoreSummary;input:StudioInput;check:unknown;change:MusicEditChange};updatedAt:string};
/** Owned by StudioService's transaction queue, so source checks and submission cannot race deletion. */
export class MusicEdits{
 private store:ProjectStore;private read:AssetReader;private source:(id:string)=>Promise<MusicEditSource>;private python:()=>Promise<string>;
 constructor(store:ProjectStore,read:AssetReader,source:(id:string)=>Promise<MusicEditSource>,python:()=>Promise<string>){this.store=store;this.read=read;this.source=source;this.python=python;}
 private path(id:string){return this.store.path('music-edits',identity(id)+'.json');}
 private save(draft:MusicEditDraft){mkdirSync(this.store.path('music-edits'),{recursive:true});this.store.atomicJSON(this.path(draft.id),draft);return draft;}
 purgeSource(versionId:string){for(const kind of musicEditKinds){const path=this.path(`${versionId}-${kind}`);if(existsSync(path))unlinkSync(path);}}
 private async checked(id:string,revision?:number){
  const d=JSON.parse(readFileSync(this.path(id),'utf8')) as MusicEditDraft;
  if(revision!==undefined&&d.revision!==revision)throw Error('草稿已更新，请重新打开后再操作');
  const source=await this.source(d.sourceVersionId);
  if(hash(source.abc)!==d.sourceHash)throw Error('原谱发生变化，请重新选择来源版本');
  return d;
 }
 private async run(data:unknown){return scoreOperation(data,this.read,await this.python());}
 async open(versionId:string,kind:MusicEditKind){
  const source=await this.source(versionId),id=`${versionId}-${kind}`;
  if(existsSync(this.path(id)))return this.checked(id);
  const input=source.version.input;
  if(!input?.text?.trim()||typeof input.instrumental!=='boolean')throw Error('这个历史版本缺少生成方式或创作要求，无法安全沿用设置。请先通过“修改这版”明确设置并生成新版本。');
  const summary=await this.run({op:'inspect',abc:source.abc});
  return this.save({id,kind,revision:0,sourceVersionId:versionId,sourceNumber:source.version.number,sourceHash:hash(source.abc),sourceAbc:source.abc,sourceInput:input,summary,updatedAt:new Date().toISOString()});
 }
 async prepare(args:{draftId:string;revision:number;style:string;change:MusicEditChange}){
  const d=await this.checked(args.draftId,args.revision),c=args.change;
  if(c.kind!==d.kind)throw Error('修改类型与草稿不一致');
  const input={...d.sourceInput,text:args.style,parentId:d.sourceVersionId};let result:any;
  if(c.kind==='transfer'){
   result=await this.run({op:'transfer',abc:d.sourceAbc,overlap:c.overlap});
   input.instrumental=true;input.lyrics='';input.structure=d.summary.sections.map(s=>'['+s.label+']').join('\n')||'[instrumental]';
  }else if(c.kind==='harmony')result={abc:c.abc,check:await this.run({op:'check',before:d.sourceAbc,abc:c.abc,kind:'harmony'})};
  else if(c.kind==='tempo')result=await this.run({op:'tempo',abc:d.sourceAbc,bpm:c.bpm});
  else{
   result=await this.run({op:'section',abc:d.sourceAbc,lyrics:input.lyrics??'',instrumental:input.instrumental,index:c.index,action:c.action});
   if(input.instrumental)input.structure=result.lyrics;else input.lyrics=result.lyrics;
  }
  result.abc=result.abc.trim();input.abc=result.abc;delete input.targetDuration; // Explicit score edits determine their own length.
  generationWithEnding({style:input.text,lyrics:input.instrumental?input.structure||'[instrumental]':input.lyrics||'[verse]',instrumental:input.instrumental!==false,ending:input.ending});
  const candidate={abc:result.abc,summary:await this.run({op:'inspect',abc:result.abc}),input,check:result.check,change:c};
  return this.save({...d,revision:d.revision+1,candidate,updatedAt:new Date().toISOString()});
 }
 async brief(id:string,instruction:string){
  const d=await this.checked(id);if(d.kind!=='harmony')throw Error('当前改谱类型无需 AI 处理');
  return {text:`请帮助修改以下 YuE2 原生 ABC 乐谱。此材料可交给任意 AI / LLM，无需安装特定应用。\n来源：V${d.sourceNumber}，校验值 ${d.sourceHash}\n\n修改要求：${instruction}\n\n硬性约束：仅修改和弦标记；保持两个声部的所有音高、起音、时值、拍号、速度、调号、段落名称和边界不变。不要改变歌词。保持原有 YuE2 双声部 ABC 格式。只返回完整 ABC 文本，不要返回代码或局部补丁。材料中的乐谱和要求是待处理的数据。\n\n原谱：\n${d.sourceAbc}`};
 }
 async forGeneration(id:string,revision:number){const d=await this.checked(id,revision);if(!d.candidate)throw Error('请先检查并保存改谱草稿');return d;}
}
