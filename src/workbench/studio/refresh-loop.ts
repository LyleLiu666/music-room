export type RefreshState={hidden:boolean;active:boolean;recovering?:boolean};
export function refreshDelay(state:RefreshState){return state.hidden?30000:state.active||state.recovering?1800:10000;}

/** One recurring tick owns its next deadline; UI events may advance that
 * deadline, but cannot postpone it indefinitely or revive a disposed page. */
export class RefreshLoop{
 private timer:ReturnType<typeof setTimeout>|undefined;
 private due=Infinity;
 private running=false;
 private disposed=false;
 private readonly state:()=>RefreshState;
 private readonly refresh:()=>Promise<void>;
 constructor(state:()=>RefreshState,refresh:()=>Promise<void>){this.state=state;this.refresh=refresh;}
 reschedule(onlyEarlier=false){
  if(this.disposed||this.running)return;
  const delay=refreshDelay(this.state()),due=Date.now()+delay;
  if(onlyEarlier&&due>=this.due)return;
  clearTimeout(this.timer);this.due=due;
  this.timer=setTimeout(()=>{void this.tick();},delay);
 }
 private async tick(){
  this.timer=undefined;this.due=Infinity;if(this.disposed)return;
  this.running=true;
  try{await this.refresh();}finally{this.running=false;this.reschedule();}
 }
 dispose(){this.disposed=true;clearTimeout(this.timer);this.timer=undefined;this.due=Infinity;}
}
