export type VoiceFilter='all'|'favorite'|'ready';
type Voice={name:string;favorite?:boolean;deleted?:boolean;processing?:{state:string}};
export function browsedVoices<T extends Voice>(voices:T[],query:string,filter:VoiceFilter){
 const needle=query.trim().toLocaleLowerCase();
 return voices.filter(v=>!v.deleted&&v.name.toLocaleLowerCase().includes(needle)&&(filter!=='favorite'||v.favorite)&&(filter!=='ready'||!v.processing||v.processing.state==='succeeded'));
}
