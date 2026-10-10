export function speedControls(){return `<div class="speed-controls" role="group" aria-label="试听调速"><div class="speed-adjustment"><label for="playback-speed">播放速度</label><input id="playback-speed" type="range" min="0.5" max="2" step="0.01" value="1" aria-describedby="speed-note"><output id="playback-speed-value" for="playback-speed">1.00 倍</output><button type="button" class="quiet" data-speed-preset="0.8">0.8 倍</button><button type="button" class="quiet" data-speed-preset="1">原速</button></div><div class="speed-save"><p id="speed-note" class="field-note">先调速试听，满意后保存为新版本。原版保留。</p><button type="button" class="secondary" id="save-speed" disabled>保存调速版</button></div><p id="speed-error" class="field-note" role="alert" hidden></p></div>`;}

/** The controls share the player's lifetime, so polling cannot interrupt a drag. */
export function bindSpeedControls(audio:HTMLAudioElement,save:(rate:number,requestId:string)=>Promise<void>){
 if(audio.dataset.speedBound)return;audio.dataset.speedBound='true';audio.preservesPitch=true;
 const container=audio.closest('.player-space')!;
 const slider=container.querySelector<HTMLInputElement>('#playback-speed')!,value=container.querySelector<HTMLOutputElement>('#playback-speed-value')!,button=container.querySelector<HTMLButtonElement>('#save-speed')!,note=container.querySelector<HTMLElement>('#speed-note')!,error=container.querySelector<HTMLElement>('#speed-error')!;
 const presets=container.querySelectorAll<HTMLButtonElement>('[data-speed-preset]');
 let saving=false,request:{rate:number;id:string}|undefined;
 const update=()=>{
  const rate=audio.playbackRate,valid=rate>=.5&&rate<=2;
  slider.value=String(rate);value.value=`${rate.toFixed(2)} 倍`;slider.disabled=saving;
  slider.setAttribute('aria-valuetext',`${rate.toFixed(2)} 倍`);
  button.disabled=saving||!valid||rate===1||!audio.src;
  button.textContent=saving?'正在保存…':'保存调速版';
  presets.forEach(b=>{b.disabled=saving;b.setAttribute('aria-pressed',String(Number(b.dataset.speedPreset)===rate));});
  note.textContent=saving?'正在处理音频并保存，原版保留。':!valid?'保存调速版支持 0.5–2.0 倍，请先调整速度。':rate===1?'先调速试听，满意后保存为新版本。原版保留。':`预计时长 ${Number.isFinite(audio.duration)?(audio.duration/rate).toFixed(1)+' 秒':'读取中'} · 保持音调，保存为新版本。`;
 };
 slider.oninput=()=>{audio.playbackRate=Number(slider.value);update();};
 presets.forEach(b=>b.onclick=()=>{audio.playbackRate=Number(b.dataset.speedPreset);update();});
 audio.addEventListener('ratechange',update);audio.addEventListener('loadedmetadata',update);
 button.onclick=async()=>{
  if(button.disabled)return;
  const rate=audio.playbackRate;
  if(request?.rate!==rate)request={rate,id:crypto.randomUUID()};
  saving=true;error.hidden=true;update();
  try{await save(rate,request.id);}catch(e){error.textContent=`保存失败：${(e as Error).message}。可重试，原版未改变。`;error.hidden=false;}
  finally{saving=false;update();}
 };
 update();
}
