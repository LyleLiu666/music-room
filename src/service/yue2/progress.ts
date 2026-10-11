import type {YuE2Job} from './contracts.ts';
export type MusicStage='queued'|'load'|'plan'|'semantic'|'conditioning'|'synthesize'|'decode'|'save'|'running';
export type MusicProgress={stage:MusicStage;startedAt?:number;updatedAt?:number;checkedAt?:number;completed?:number;total?:number;unit?:'steps'|'chunks';tokens?:number;seconds?:number};
const stages=new Set<MusicStage>(['queued','load','plan','semantic','conditioning','synthesize','decode','save','running']);
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:undefined;
const seconds=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined;
const timestamp=(v:unknown)=>{const n=typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(n)&&n>0?n:undefined;};
/** Only protocol fields decide the stage; no interpretation of model text or generated lyrics. */
export function musicProgress(job:YuE2Job):MusicProgress|undefined{
 if(job.status!=='running'&&job.status!=='queued')return;
 const p=job.progress??{},raw=p.phase==='abc'?'plan':p.phase==='semantic'?'semantic':p.stage;
 const resource=job.resource as {stage?:string}|undefined;
 const stage:MusicStage=job.status==='queued'?(resource?.stage==='loading'?'load':'queued'):stages.has(raw as MusicStage)?raw as MusicStage:'running';
 const known=stage==='synthesize'&&p.unit==='steps'||stage==='decode'&&p.unit==='chunks',completed=known?count(p.completed):undefined,total=known?count(p.total):undefined;
 return {stage,startedAt:timestamp(job.started_at),updatedAt:timestamp(p.ts),checkedAt:seconds(job.checkedAt),tokens:count(p.tokens),seconds:seconds(p.seconds),...(completed!==undefined&&total!==undefined&&total>0&&completed<=total?{completed,total,unit:p.unit as 'steps'|'chunks'}:{})};
}
