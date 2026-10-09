// Interaction prototype only. This state never reads or writes the real workspace.
const uid=()=>crypto.randomUUID();
const titleOf=value=>{if(typeof value!=='string'||!value.trim())throw new Error('请填写名称');return value.trim().slice(0,120);};
export const kinds={clip:'音乐片段',music:'完整音乐',speech:'语音'};
export function createDemo(){
  const versions=[
    {id:'rain-v1',number:1,prompt:'钢琴为主，旋律多一些变化，温暖而克制。',note:'最初的想法，钢琴旋律更丰富。',status:'done',kept:true,audio:'../../exports/rain-letter-v1/song.wav',duration:180,score:'../../exports/rain-letter-v1/song.mid'},
    {id:'rain-v2',number:2,parentId:'rain-v1',prompt:'保留两小节主题，用留白和配器变化推进。',note:'减少密集音符，让主题更容易被记住。',status:'done',kept:false,audio:'../../exports/rain-letter-v2/song.wav',duration:180,score:'../../exports/rain-letter-v2/song.mid'}
  ];
  return {schema:1,projects:[{id:'rain',title:'雨巷来信',description:'一段下雨天的散步。从一个旋律，慢慢长成一首歌。',sounds:[
    {id:'song',title:'雨巷来信',kind:'music',vocal:'instrumental',duration:'3 分钟',draft:'温暖的钢琴器乐，带一点雨天的安静。两小节主题贯穿，配器逐步展开，最后自然收尾。',versions,finalId:'rain-v2'},
    {id:'intro',title:'开场动机',kind:'clip',duration:'20 秒',draft:'从完整音乐中试一段轻盈的开场。',versions:[{id:'intro-v1',number:1,status:'done',kept:true,prompt:'试听完整音乐的前 20 秒，作为开场参考。',note:'示例摘录 · 来自《雨巷来信》第二版的前 20 秒。',audio:'../../exports/rain-letter-v2/song.wav',duration:20}],finalId:null},
    {id:'voice',title:'片头旁白',kind:'speech',duration:'随文本自然生成',draft:'平静、温暖的情绪。',script:'下雨的时候，城市也会慢下来。',versions:[],finalId:null}
  ]}]};
}
export function createProject(state,title){const p={id:uid(),title:titleOf(title),description:'',sounds:[]};state.projects.push(p);return p;}
export function createSound(project,values){if(!kinds[values.kind])throw new Error('请选择声音类型');const s={id:uid(),title:titleOf(values.title),kind:values.kind,vocal:values.vocal??'instrumental',duration:values.duration??'自由长度',draft:values.draft??'',versions:[],finalId:null};project.sounds.push(s);return s;}
export const activeVersions=sound=>sound.versions.filter(v=>!v.deleted);
export function startVersion(sound,prompt,parentId){
  if(parentId&&!activeVersions(sound).some(v=>v.id===parentId&&v.status==='done'))throw new Error('来源版本不可用');
  const v={id:uid(),number:Math.max(0,...sound.versions.map(v=>v.number))+1,status:'running',prompt,kept:false,parentId,note:'交互演示 · 未调用生成模型'};sound.versions.push(v);return v;
}
export function finishVersion(state,projectId,soundId,versionId,status){
  const v=state.projects.find(p=>p.id===projectId)?.sounds.find(s=>s.id===soundId)?.versions.find(v=>v.id===versionId);
  if(!v||v.status!=='running')return;
  v.status=status;if(status==='failed')v.error='演示：生成服务暂时无法连接。创作要求已保留，可重试。';
}
export function deleteVersion(sound,id){const v=sound.versions.find(v=>v.id===id);if(!v||v.status==='running')throw new Error('请先取消生成，再删除版本');v.deleted=true;if(sound.finalId===id)sound.finalId=null;}
export function restoreVersion(sound,id){const v=sound.versions.find(v=>v.id===id);if(v)v.deleted=false;}
export function setFinal(sound,id){if(!activeVersions(sound).some(v=>v.id===id&&v.status==='done'))throw new Error('只能选择已完成的版本');sound.finalId=sound.finalId===id?null:id;}
export function recoverJobs(state){for(const p of state.projects)for(const s of p.sounds)for(const v of s.versions)if(v.status==='running'){v.status='failed';v.error='演示已中断，创作要求已保留。可重新演示生成。';}return state;}
