import type {MusicEnding} from './contracts.ts';

// Form payload limits, not model capacity. The installed tokenizer checks context separately.
export const musicInputLimits={style:100000,lyrics:100000,abc:100000} as const;
export type MusicContext={prefixTokens:number;planningTokens:number;semanticTokens:number;contextTokens:number;requiredTokens:number;remainingTokens:number;issue?:string};
export function musicContextStatus(counts:Omit<MusicContext,'requiredTokens'|'remainingTokens'|'issue'>):MusicContext{
 const requiredTokens=counts.prefixTokens+counts.planningTokens+counts.semanticTokens;
 const remainingTokens=counts.contextTokens-requiredTokens;
 return {...counts,requiredTokens,remainingTokens,...(remainingTokens<0?{issue:`创作内容与生成预算共需 ${requiredTokens} 个 token，超过模型 ${counts.contextTokens} 个 token 的上下文容量。请缩短风格、歌词或乐谱后再试。`}:{})};
}

/** Explicit preference, never inferred from words in the user's creative description. */
export function generationWithEnding(input:{style:string;lyrics:string;instrumental:boolean;ending?:MusicEnding}){
 if(input.ending==='as-described')return {style:input.style,lyrics:input.lyrics};
 const guidance='Ending arrangement: plan a complete outro. Finish the final musical phrase and resolve the harmony; gradually thin the accompaniment, sustain the final chord, and allow its natural decay before ending. Do not introduce a new phrase at the end or stop mid-phrase.';
 return {
  style:input.style+'\n\n'+guidance+(input.instrumental?'':' Finish singing all supplied lyrics before the instrumental outro. Do not sing these arrangement instructions.'),
  // [instrumental] is the API's explicit default protocol; custom structures and lyrics stay intact.
  lyrics:input.instrumental&&input.lyrics.trim()==='[instrumental]'?'[instrumental]\n[intro]\n[verse]\n[outro]':input.lyrics,
 };
}
