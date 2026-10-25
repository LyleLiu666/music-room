/** Controls the existing audio element; never creates another audio player. */
export function playbackBar(){return `<section class="bar-playback" aria-label="正在播放"><button type="button" data-queue-transport data-queue-action="previous" aria-label="上一首" hidden>‹</button><button type="button" data-bar-toggle aria-label="播放" disabled>▶</button><button type="button" data-queue-transport data-queue-action="next" aria-label="下一首" hidden>›</button><button type="button" data-bar-title data-action="return-playback" title="返回正在播放的作品">暂无播放</button><input data-bar-progress type="range" min="0" max="1" step="0.1" value="0" aria-label="播放进度" disabled><output data-bar-time>0:00 / 0:00</output><button type="button" data-queue-transport data-queue-action="mode" aria-label="切换播放方式" hidden>顺序</button><button type="button" data-queue-action="open" aria-label="播放队列">队列 0</button></section>`;}
export function bindPlaybackBar(root:HTMLElement,title:(audio:HTMLAudioElement)=>string){
 let current:HTMLAudioElement|undefined;
 const time=(n:number)=>`${Math.floor(n/60)}:${Math.floor(n%60).toString().padStart(2,'0')}`;
 const text=(node:Element|null,value:string)=>{if(node&&node.textContent!==value)node.textContent=value;};
 function update(){
  if(current&&!current.isConnected)current=undefined;
  const duration=current&&Number.isFinite(current.duration)?current.duration:0;
  for(const bar of root.querySelectorAll<HTMLElement>('.bar-playback')){
   const button=bar.querySelector<HTMLButtonElement>('[data-bar-toggle]')!,range=bar.querySelector<HTMLInputElement>('[data-bar-progress]')!;
   button.disabled=!current;button.setAttribute('aria-label',current&&!current.paused?'暂停':'播放');text(button,current&&!current.paused?'Ⅱ':'▶');
   const name=current?title(current):'暂无播放';bar.querySelector<HTMLElement>('[data-bar-title]')!.dataset.audioKind=current?.id??'';text(bar.querySelector('[data-bar-title]'),name);bar.querySelector<HTMLElement>('[data-bar-title]')!.title=name;
   range.disabled=!duration;range.max=String(duration||1);range.value=String(current?.currentTime??0);text(bar.querySelector('[data-bar-time]'),`${time(current?.currentTime??0)} / ${time(duration)}`);
  }
 }
 root.addEventListener('queueactivate',e=>{if(e.target instanceof HTMLAudioElement){current=e.target;update();}});
 for(const event of ['play','pause','timeupdate','durationchange','ended','loadedmetadata'])root.addEventListener(event,e=>{if(!(e.target instanceof HTMLAudioElement))return;if(event==='play')current=e.target;update();},true);
 root.addEventListener('click',e=>{if((e.target as Element).closest('[data-bar-toggle]')&&current){if(!current.dispatchEvent(new Event('playbacktoggle',{cancelable:true})))return;if(current.paused)void current.play().catch(()=>update());else current.pause();}});
 root.addEventListener('input',e=>{const input=e.target;if(input instanceof HTMLInputElement&&input.matches('[data-bar-progress]')&&current&&Number.isFinite(current.duration)){current.currentTime=Number(input.value);update();}});
 new MutationObserver(update).observe(root,{childList:true,subtree:true});update();return update;
}
