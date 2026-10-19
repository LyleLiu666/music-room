import type {MusicEnding} from './contracts.ts';
import {durationGuidance} from './duration.ts';

// Form payload limits, not model capacity. The installed tokenizer checks context separately.
export const musicInputLimits={style:100000,lyrics:100000,abc:100000} as const;
export type MusicContext={prefixTokens:number;planningTokens:number;semanticTokens:number;contextTokens:number;requiredTokens:number;remainingTokens:number;issue?:string};
export function musicContextStatus(counts:Omit<MusicContext,'requiredTokens'|'remainingTokens'|'issue'>):MusicContext{
 const requiredTokens=counts.prefixTokens+counts.planningTokens+counts.semanticTokens;
 const remainingTokens=counts.contextTokens-requiredTokens;
 return {...counts,requiredTokens,remainingTokens,...(remainingTokens<0?{issue:`创作内容与生成预算共需 ${requiredTokens} 个 token，超过模型 ${counts.contextTokens} 个 token 的上下文容量。请缩短风格、歌词或乐谱后再试。`}:{})};
}

/** Explicit preference, never inferred from words in the user's creative description. */
export function generationWithEnding(input:{style:string;lyrics:string;instrumental:boolean;ending?:MusicEnding;targetDuration?:number}){
 // This is validation of the documented section-tag protocol, never intent detection.
 if(input.instrumental&&!/^(?:\s*\[[a-z][a-z0-9 _-]*\]\s*)+$/i.test(input.lyrics))throw new Error('纯音乐只接受不带时间的段落标签，例如 [Intro]、[Verse]、[Outro]；请移除歌词正文。');
 const style=(input.instrumental?input.style+'\n\nInstrumental music only. All melodies are played by instruments. No vocals, singing, humming, spoken words or vocal samples.':input.style)+durationGuidance(input.targetDuration,input.instrumental);
 if(input.ending==='as-described')return {style,lyrics:input.lyrics};
 const guidance='Ending arrangement: plan a complete outro. Finish the final musical phrase and resolve the harmony; gradually thin the accompaniment, sustain the final chord, and allow its natural decay before ending. Do not introduce a new phrase at the end or stop mid-phrase.';
 return {
  style:style+'\n\n'+guidance+(input.instrumental?'':' Finish singing all supplied lyrics before the instrumental outro. Do not sing these arrangement instructions.'),
  // Preserve the explicit instrumental protocol and user-supplied structures verbatim.
  lyrics:input.lyrics,
 };
}
