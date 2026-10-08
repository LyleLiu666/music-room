import {z} from 'zod';
export const yue2JobId=z.string().regex(/^[a-f0-9]{32}$/);
export const yue2JobSchema=z.object({id:yue2JobId,status:z.enum(['queued','running','done','failed','cancelled']),kind:z.string(),title:z.string().nullable().optional(),error:z.string().nullable().optional(),stage:z.string().nullable().optional(),progress:z.record(z.string(),z.unknown()).nullable().optional(),timing:z.record(z.string(),z.number().nullable()).nullable().optional()}).passthrough();
export type YuE2Job=z.infer<typeof yue2JobSchema>;
export type YuE2JobResult={job:YuE2Job;audioPath?:string};
export type YuE2Generate={style:string;lyrics:string;preset:'fast'|'quality';instrumental:boolean;seed?:number;title?:string};
