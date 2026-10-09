/** Saved IDs keep their original values when listening feedback changes labels. */
export const emotionStrengths=['minimal','subtle','flat','normal','strong'] as const;
export type EmotionStrength=typeof emotionStrengths[number];
export const emotionStrengthLabels:Record<EmotionStrength,string>={minimal:'情绪非常平淡',subtle:'情绪平淡',flat:'情绪一般',normal:'情绪强烈',strong:'情绪非常强烈'};
export const emotionStrengthValues:Record<EmotionStrength,number>={minimal:.03,subtle:.1,flat:.3,normal:.6,strong:1};
export function emotionAlpha(emotion?:string,strength?:EmotionStrength){
 if(strength===undefined)return emotion?.trim()? .6 : 1;
 if(!emotionStrengths.includes(strength))throw new Error('情绪强度无效');
 return emotionStrengthValues[strength];
}
/** Old inputs retain their missing field; their form displays the old effective tier. */
export function displayedEmotionStrength(input:{emotion?:string;emotionStrength?:EmotionStrength}):EmotionStrength{return input.emotionStrength??(input.emotion?.trim()?'normal':'strong');}
