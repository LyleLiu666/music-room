/** Visits belong to navigation, never to edits or background refreshes. */
export class SoundVisits {
 timestamps:Record<string,number>={};
 private current='';
 constructor(saved:unknown={}){if(saved&&typeof saved==='object')for(const [id,time] of Object.entries(saved))if(typeof time==='number'&&Number.isFinite(time))this.timestamps[id]=time;}
 enter(id:string,now=Date.now()){
  if(id===this.current)return;
  this.current=id;
  if(id)this.timestamps[id]=Math.max(now,...Object.values(this.timestamps).map(t=>t+1));
 }
 sort<T extends {id:string}>(sounds:T[]):T[]{return sounds.toSorted((a,b)=>(this.timestamps[b.id]??0)-(this.timestamps[a.id]??0));}
}

export function bindSoundOverflow(){
 const panel=document.querySelector<HTMLElement>('#sound-overflow');
 const trigger=document.querySelector<HTMLElement>('[popovertarget="sound-overflow"]');
 if(!panel||!trigger)return;
 const input=panel.querySelector<HTMLInputElement>('input')!;
 input.oninput=()=>{
  let count=0;
  for(const button of panel.querySelectorAll<HTMLButtonElement>('[data-action="sound"]')){
   button.hidden=!button.textContent!.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase());
   if(!button.hidden)count++;
  }
  panel.querySelector<HTMLElement>('.sound-search-empty')!.hidden=count>0;
 };
 panel.addEventListener('toggle',()=>{
  const open=panel.matches(':popover-open');trigger.setAttribute('aria-expanded',String(open));
  if(open){const rect=trigger.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))}px`;panel.style.top=`${rect.bottom+6}px`;input.focus();}
 });
}
