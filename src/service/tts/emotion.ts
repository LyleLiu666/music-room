/** Stable saved tiers; alpha values remain internal audition candidates. */
export const emotionStrengths=['flat','normal','strong'] as const;
export type EmotionStrength=typeof emotionStrengths[number];
export const emotionStrengthLabels:Record<EmotionStrength,string>={flat:'情绪平淡',normal:'情绪一般',strong:'情绪强烈'};
export const emotionStrengthValues:Record<EmotionStrength,number>={flat:.3,normal:.6,strong:1};
export function emotionAlpha(emotion?:string,strength?:EmotionStrength){
 if(strength===undefined)return emotion?.trim()? .6 : 1;
 if(!emotionStrengths.includes(strength))throw new Error('情绪强度无效');
 return emotionStrengthValues[strength];
}
/** Old inputs retain their missing field; their form displays the old effective tier. */
export function displayedEmotionStrength(input:{emotion?:string;emotionStrength?:EmotionStrength}):EmotionStrength{return input.emotionStrength??(input.emotion?.trim()?'normal':'strong');}
