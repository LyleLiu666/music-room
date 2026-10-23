import type {StudioInput} from '../../service/studio/studio.ts';

type Storage = Pick<globalThis.Storage,'length'|'key'|'getItem'|'setItem'>;
type Exclusive = <T>(action:()=>T)=>Promise<T>;

/** One record per sound; the browser lock makes conflict checks and writes atomic. */
export class StudioDraftStorage {
 private prefix:string;
 private baseline=new Map<string,string|null>();
 private saved=new Map<string,string>();
 private pending:Promise<unknown>=Promise.resolve();
 private storage:Storage;
 private exclusive:Exclusive;
 constructor(storage:Storage,workspaceKey:string,exclusive:Exclusive){this.storage=storage;this.exclusive=exclusive;this.prefix=workspaceKey+':draft:';}
 load(legacy:Record<string,StudioInput>={}){
  const drafts:Record<string,StudioInput>=structuredClone(legacy);
  for(let i=0;i<this.storage.length;i++){
   const key=this.storage.key(i);if(!key?.startsWith(this.prefix))continue;
   const raw=this.storage.getItem(key)!;let value:StudioInput;
   try{value=JSON.parse(raw);}catch{throw Error('已保存草稿损坏，请保留当前输入并检查浏览器存储');}
   const id=key.slice(this.prefix.length);
   if(!value||value.soundId!==id||typeof value.text!=='string')throw Error('已保存草稿格式无效');
   drafts[id]=value;this.baseline.set(id,raw);this.saved.set(id,JSON.stringify(value));
  }
  // Legacy drafts are migrated on the next save; absence is the expected revision.
  for(const id of Object.keys(drafts))if(!this.baseline.has(id))this.baseline.set(id,null);
  return drafts;
 }
 hasUnsaved(drafts:Record<string,StudioInput>){return Object.entries(drafts).some(([id,draft])=>this.saved.get(id)!==JSON.stringify(draft));}
 save(drafts:Record<string,StudioInput>){
  const snapshot=structuredClone(drafts);
  return this.serial(()=>this.exclusive(()=>{
   const conflicts:string[]=[];
   for(const [id,draft] of Object.entries(snapshot)){
    const value=JSON.stringify(draft);if(this.saved.get(id)===value)continue;
    const key=this.prefix+id,current=this.storage.getItem(key);
    if(current!==value&&current!==(this.baseline.get(id)??null)){conflicts.push(id);continue;}
    this.storage.setItem(key,value);this.baseline.set(id,value);this.saved.set(id,value);
   }
   return conflicts;
  }));
 }
 resolve(drafts:Record<string,StudioInput>,id:string,choice:'local'|'saved'){
  return this.serial(()=>this.exclusive(()=>{
   const key=this.prefix+id;
   if(choice==='local'){
    const value=JSON.stringify(drafts[id]);this.storage.setItem(key,value);this.baseline.set(id,value);this.saved.set(id,value);
   }else{
    const raw=this.storage.getItem(key);if(!raw)throw Error('另一窗口的草稿已不存在');
    const value=JSON.parse(raw);if(value?.soundId!==id||typeof value.text!=='string')throw Error('已保存草稿格式无效');
    drafts[id]=value;this.baseline.set(id,raw);this.saved.set(id,JSON.stringify(value));
   }
  }));
 }
 private serial<T>(action:()=>Promise<T>){const next=this.pending.then(action);this.pending=next.catch(()=>{});return next;}
}
