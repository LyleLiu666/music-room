import type {StudioInput,StudioVersion} from '../../service/studio/studio.ts';
export function newCreationDraft(soundId:string,voiceId?:string):StudioInput{return {soundId,text:'',voiceId,instrumental:true,emotionStrength:'flat'};}
/** Cloning keeps historical missing strength absent rather than applying new defaults. */
export function versionCreationDraft(soundId:string,versionId:string,input?:StudioInput):StudioInput{return {...input,soundId,text:input?.text??'',parentId:versionId};}
/** A fresh attempt must not inherit the unfinished source's three planning seeds. */
export function clearFailedMusicSeed(draft:StudioInput,source?:StudioVersion):number|undefined {
 if(!source||source.soundId!==draft.soundId||source.source.kind!=='music'||source.musicRecovery||!['failed','cancelled','interrupted'].includes(source.state)||source.input?.seed===undefined||draft.seed===undefined)return;
 if(![0,1,2].some(offset=>(source.input!.seed!+offset)%2147483648===draft.seed))return;
 const oldSeed=draft.seed;delete draft.seed;return oldSeed;
}
