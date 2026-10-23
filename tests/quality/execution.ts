export type GenerationTrial={key:string;status:string};
/** Current outcome per required run; historical attempts remain in the raw log. */
export function generationSummary(trials:GenerationTrial[],required:string[]){
 const current=required.map(key=>trials.findLast(t=>t.key===key));
 const succeeded=current.filter(t=>t?.status==='succeeded').length,failed=current.filter(t=>t?.status==='failed').length,blocked=current.filter(t=>t?.status==='blocked').length;
 return {status:failed?'failed':blocked?'blocked':succeeded<required.length?'incomplete':required.length?'succeeded':'not-run',required:required.length,succeeded,failed,blocked};
}
/** Lyrics-only acceptance is valid; an empty selection or an unfinished requested layer is not. */
export function qualityExecutionPassed(generation:ReturnType<typeof generationSummary>,lyricsRequired:boolean,lyricsPassed:boolean){
 return (generation.required>0||lyricsRequired)&&(generation.required===0||generation.status==='succeeded')&&(!lyricsRequired||lyricsPassed);
}
