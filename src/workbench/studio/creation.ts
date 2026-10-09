import type {StudioInput} from '../../service/studio/studio.ts';
export function newCreationDraft(soundId:string,voiceId?:string):StudioInput{return {soundId,text:'',voiceId,instrumental:true,emotionStrength:'normal'};}
/** Cloning keeps historical missing strength absent rather than applying new defaults. */
export function versionCreationDraft(soundId:string,versionId:string,input?:StudioInput):StudioInput{return {...input,soundId,text:input?.text??'',parentId:versionId};}
