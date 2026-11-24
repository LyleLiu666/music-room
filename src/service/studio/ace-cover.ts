import {z} from 'zod';
import {SCORE_ID_PATTERN} from '../../music/authoring/validate.mjs';
import type {LyricsResult} from './lyrics.ts';

export const coverStrengths={close:.875,balanced:.625,bold:.375} as const;
export const coverModel='acestep-v15-turbo-Q5_K_M.gguf';
export const coverProfile={id:'ace-step-v15-turbo-q5-metal',revision:'973517be024ff8b6bbd50e0adc9e308ab2ed71b3',weights:'666ac70204440867d8c01ba4b119cc79c95b370a'};
export const coverRange={
 startSeconds:z.number().finite().min(0).max(600),
 endSeconds:z.number().finite().positive().max(600),
};
export const coverRequest=z.object({
 versionId:z.string().regex(SCORE_ID_PATTERN),
 requestId:z.string().regex(SCORE_ID_PATTERN),
 ...coverRange,
 style:z.string().trim().min(1).max(1200),
 lyrics:z.string().trim().max(8000),
 strength:z.enum(['close','balanced','bold']),
}).strict().refine(({startSeconds,endSeconds})=>endSeconds-startSeconds>=10&&endSeconds-startSeconds<=60,'翻唱片段需为 10–60 秒');
export type CoverRequest=z.output<typeof coverRequest>;
export type CoverProvenance=Omit<CoverRequest,'versionId'>&{sourceVersionId:string;sourceNumber:number;seed:number;bpm?:number};
export function coverLyrics(result:LyricsResult,{startSeconds,endSeconds}:Pick<CoverRequest,'startSeconds'|'endSeconds'>){
 if(result.kind==='synced')return {kind:'synced' as const,text:result.lines.filter(line=>line.end>startSeconds&&line.start<endSeconds).map(line=>line.text).join('\n')};
 return {kind:result.kind,text:result.reference};
}
