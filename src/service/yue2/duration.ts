/** Explicit creation option; omission preserves the model's original free-length behavior. */
export const musicDurations=[60,120,180,240,300] as const;
export function durationWithinTarget(seconds:number,target:number){return Number.isFinite(seconds)&&seconds>=target*(1-.15)&&seconds<=target*(1+.15);}
export function durationGuidance(target:number|undefined,instrumental:boolean){
 if(target===undefined)return '';
 if(!musicDurations.includes(target as typeof musicDurations[number]))throw Error('目标时长请选择约 1–5 分钟');
 return `\n\nDuration arrangement: approximately ${target} seconds in total. Plan the complete ABC score before rendering. At the chosen tempo, total quarter-note beats = ${target} * BPM / 60. Distribute those beats across complete musical sections, with a beginning, development and ending. Keep a musically appropriate tempo; do not slow down the whole piece just to fill time. ${instrumental?'Develop instrumental themes, variations, interludes and a reprise across that duration. All parts remain instrumental.':'Do not add, delete, repeat or rewrite any supplied lyric words. Preserve their order. Allocate enough bars for natural singing; use instrumental introductions, interludes and an outro for the remaining time. Do not sing these arrangement instructions.'}`;
}
